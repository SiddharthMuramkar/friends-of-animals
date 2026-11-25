import { and, asc, eq, gt, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { event, type EventRow } from "../../db/schema";
import { emit } from "../../outbox";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import { stripMarkup } from "../../rich-text/strip-markup";
import type { UseCaseContext } from "../../use-cases";
import {
  eventDetailsSchema,
  publishableProblems,
  type EventDetailsInput,
} from "./domain/event-details";
import { canMoveEvent } from "./domain/event-status";
import { eventSlugCandidates } from "./domain/slug";
import { promoteWaitlist } from "./registrations";
import { eventChanges } from "./domain/changes";
import { finishEvent, queueEnd } from "./end";
import { eventRows, lockEvent, placesTaken, publicView } from "./repository";

const idSchema = z.object({ eventId: z.uuid() });
export type EventId = z.input<typeof idSchema>;
function clean(input: EventDetailsInput) {
  return eventDetailsSchema.safeParse({
    ...input,
    title:
      typeof input.title === "string" ? stripMarkup(input.title) : input.title,
    summary:
      typeof input.summary === "string"
        ? stripMarkup(input.summary)
        : input.summary,
    description:
      typeof input.description === "string"
        ? stripMarkup(input.description)
        : input.description,
    venueName:
      typeof input.venueName === "string"
        ? stripMarkup(input.venueName)
        : input.venueName,
    address:
      typeof input.address === "string"
        ? stripMarkup(input.address)
        : input.address,
    city: typeof input.city === "string" ? stripMarkup(input.city) : input.city,
  });
}
export async function createEvent(
  ctx: UseCaseContext,
  input: EventDetailsInput
) {
  const { role } = await authorize(ctx, "event.admin");
  const parsed = clean(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (db) => {
    const now = ctx.clock.now();
    const eventId = uuidv7(now);
    const candidates = eventSlugCandidates(
      parsed.data.title,
      parsed.data.startsAt
    );
    for (const slug of [...candidates, `event-${eventId}`]) {
      const [row] = await db
        .insert(event)
        .values({
          ...parsed.data,
          id: eventId,
          slug,
          status: "draft",
          createdByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: event.slug })
        .returning({ id: event.id });
      if (!row) continue;
      await recordAudit(db, ctx, {
        action: "event.created",
        entity: { type: "event", id: eventId },
        before: null,
        after: { status: "draft" },
        actorRole: role,
      });
      return { ok: true, eventId, slug } as const;
    }
    throw new Error("Unable to allocate event slug");
  });
}
export async function listEventsForAdmin(ctx: UseCaseContext) {
  await authorize(ctx, "event.admin");
  return ctx.db
    .select()
    .from(event)
    .orderBy(asc(event.startsAt), asc(event.id));
}
export async function getEventForAdmin(ctx: UseCaseContext, input: EventId) {
  await authorize(ctx, "event.admin");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const [row] = await ctx.db
    .select()
    .from(event)
    .where(eq(event.id, parsed.data.eventId));
  return row
    ? ({ ok: true, event: row } as const)
    : ({ ok: false, error: "not_found" } as const);
}
async function view(ctx: UseCaseContext, row: EventRow) {
  return publicView(
    row,
    ctx.clock.now(),
    placesTaken(await eventRows(ctx.db, row.id))
  );
}
export async function listPublishedEvents(ctx: UseCaseContext) {
  await authorize(ctx, "event.public");
  const rows = await ctx.db
    .select()
    .from(event)
    .where(
      and(eq(event.status, "published"), gt(event.endsAt, ctx.clock.now()))
    )
    .orderBy(asc(event.startsAt), asc(event.id));
  return { items: await Promise.all(rows.map((row) => view(ctx, row))) };
}
export async function getPublicEvent(
  ctx: UseCaseContext,
  input: { slug: string }
) {
  await authorize(ctx, "event.public");
  const [row] = await ctx.db
    .select()
    .from(event)
    .where(and(eq(event.slug, input.slug), isNotNull(event.publishedAt)));
  return row && row.status !== "draft"
    ? ({ ok: true, event: await view(ctx, row) } as const)
    : ({ ok: false, error: "not_found" } as const);
}
export async function changeStatus(
  ctx: UseCaseContext,
  input: EventId,
  status: "published" | "cancelled" | "completed"
) {
  const { role } = await authorize(ctx, "event.admin");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (db) => {
    const row = await lockEvent(db, parsed.data.eventId);
    if (!row) return { ok: false, error: "not_found" } as const;
    if (!canMoveEvent(row.status, status))
      return { ok: false, error: "invalid_transition" } as const;
    const now = ctx.clock.now();
    if (status === "published" && publishableProblems(row, now).length)
      return { ok: false, error: "starts_in_past" } as const;
    if (status === "completed" && +now < +row.endsAt)
      return { ok: false, error: "not_ended" } as const;
    if (status === "completed") {
      await finishEvent(db, ctx, row, role);
      return { ok: true } as const;
    }
    await db
      .update(event)
      .set({
        status,
        updatedAt: now,
        ...(status === "published"
          ? { publishedAt: now }
          : { cancelledAt: now }),
      })
      .where(eq(event.id, row.id));
    if (status === "published") {
      await emit(db, ctx.clock, {
        type: "event.published",
        aggregate: { type: "event", id: row.id },
        payload: { eventId: row.id },
      });
      await queueEnd(db, ctx, row);
    } else if (row.status === "published") {
      await emit(db, ctx.clock, {
        type: "event.cancelled",
        aggregate: { type: "event", id: row.id },
        payload: { eventId: row.id },
      });
    }
    await recordAudit(db, ctx, {
      action: `event.${status}`,
      entity: { type: "event", id: row.id },
      before: { status: row.status },
      after: { status },
      actorRole: role,
    });
    return { ok: true } as const;
  });
}

export async function updateEvent(
  ctx: UseCaseContext,
  input: EventId & EventDetailsInput
) {
  const { role } = await authorize(ctx, "event.admin");
  const id = idSchema.safeParse(input);
  const parsed = clean(input);
  if (!id.success) return invalidInput(id.error);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (db) => {
    const row = await lockEvent(db, id.data.eventId);
    if (!row) return { ok: false, error: "not_found" } as const;
    if (row.status !== "draft" && row.status !== "published")
      return { ok: false, error: "invalid_transition" } as const;
    const now = ctx.clock.now();
    const changes = eventChanges(row, parsed.data);
    if (
      row.status === "published" &&
      ((changes.startMoved && publishableProblems(parsed.data, now).length) ||
        +parsed.data.endsAt <= +now)
    )
      return { ok: false, error: "starts_in_past" } as const;
    const [updated] = await db
      .update(event)
      .set({ ...parsed.data, updatedAt: now })
      .where(eq(event.id, row.id))
      .returning();
    if (!updated) throw new Error("Event update lost");
    if (row.status === "published") {
      if (changes.notice.length) {
        await emit(db, ctx.clock, {
          type: "event.changed",
          aggregate: { type: "event", id: row.id },
          payload: {
            eventId: row.id,
            changes: changes.notice,
            startMoved: changes.startMoved,
          },
        });
      }
      if (+row.endsAt !== +updated.endsAt) await queueEnd(db, ctx, updated);
      await promoteWaitlist(db, ctx, updated);
    }
    const changed = Object.keys(parsed.data).filter((key) => {
      const k = key as keyof typeof parsed.data;
      return row[k] instanceof Date || parsed.data[k] instanceof Date
        ? String(row[k]) !== String(parsed.data[k])
        : row[k] !== parsed.data[k];
    });
    await recordAudit(db, ctx, {
      action: "event.updated",
      entity: { type: "event", id: row.id },
      before: null,
      after: { changed },
      actorRole: role,
    });
    return { ok: true } as const;
  });
}
