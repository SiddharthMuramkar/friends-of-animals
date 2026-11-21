// The organisers' use cases for events and campaigns (#125): create and
// edit drafts, publish, cancel, complete, and the staff list and detail.
// Each one authorizes first; each change saves its row, its outbox event
// and its audit entry in one transaction.

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { LegalBlock } from "../../../content/legal/model";
import type { AppDb } from "../../db/app-db";
import { event, type EventRow } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { sanitizeBlocks } from "../../rich-text/blocks";
import type { UseCaseContext } from "../../use-cases";
import type { EventsAccess } from "./access";
import {
  eventDetailsSchema,
  type EventDetails,
  type EventDetailsInput,
} from "./domain/event-details";
import { moveEvent } from "./domain/event-status";
import { eventSlugCandidates } from "./domain/slug";

/** One field at fault and why: a rule's code or zod's issue code. */
export type EventProblem = { field: string; code: string };

export type InvalidEventInput = {
  ok: false;
  error: "invalid_input";
  problems: EventProblem[];
};

export type EventNotFound = { ok: false; error: "not_found" };

/** An event as staff see it: every field, the description sanitised. */
export type AdminEvent = Omit<EventRow, "description"> & {
  description: LegalBlock[];
};

export type CreateEventResult =
  | { ok: true; id: string; slug: string }
  | InvalidEventInput;

export type GetEventForAdminResult =
  | { ok: true; event: AdminEvent }
  | EventNotFound;

const eventIdSchema = z.object({ eventId: z.uuid() });

/** The rich-text profile event descriptions are sanitised with. */
const PROFILE = "cms";

export function invalidEventInput(error: z.ZodError): InvalidEventInput {
  return {
    ok: false,
    error: "invalid_input",
    problems: error.issues.map((issue) => ({
      field: String(issue.path[0] ?? ""),
      code: issue.code === "custom" ? issue.message : issue.code,
    })),
  };
}

/** The stored columns for `details`, the description sanitised. */
export function detailColumns(details: EventDetails) {
  return {
    kind: details.kind,
    title: details.title,
    summary: details.summary,
    description: sanitizeBlocks(details.description, PROFILE),
    startsAt: details.startsAt,
    endsAt: details.endsAt,
    venueName: details.venueName,
    address: details.address,
    city: details.city,
    pinCode: details.pinCode,
    onlineUrl: details.onlineUrl,
    capacity: details.capacity,
    audience: details.audience,
    registrationOpensAt: details.registrationOpensAt,
    registrationClosesAt: details.registrationClosesAt,
    waitlistEnabled: details.waitlistEnabled,
  };
}

/** A stored row as staff see it; stored rich text is sanitised again. */
export function adminEvent(row: EventRow): AdminEvent {
  return { ...row, description: sanitizeBlocks(row.description, PROFILE) };
}

/**
 * Inserts the event under the first free slug among the candidates, or
 * under `event-<id>` if every one is taken. ON CONFLICT keeps two
 * organisers creating the same title at once from colliding.
 */
async function insertWithFreeSlug(
  tx: AppDb,
  values: Omit<typeof event.$inferInsert, "slug">
): Promise<string> {
  const candidates = [
    ...eventSlugCandidates(values.title, values.startsAt),
    `event-${values.id}`,
  ];
  for (const slug of candidates) {
    const [row] = await tx
      .insert(event)
      .values({ ...values, slug })
      .onConflictDoNothing({ target: event.slug })
      .returning({ slug: event.slug });
    if (row) return row.slug;
  }
  throw new Error(`No free slug for event ${values.id}`);
}

export async function createEvent(
  ctx: UseCaseContext,
  access: EventsAccess,
  input: EventDetailsInput
): Promise<CreateEventResult> {
  const { role } = await access.authorize(ctx, "event.create");
  const parsed = eventDetailsSchema.safeParse(input);
  if (!parsed.success) return invalidEventInput(parsed.error);

  const now = ctx.clock.now();
  const id = uuidv7(now);
  const status = moveEvent(null, "draft");
  const slug = await ctx.db.transaction(async (tx) => {
    const saved = await insertWithFreeSlug(tx, {
      id,
      ...detailColumns(parsed.data),
      status,
      createdByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      createdAt: now,
      updatedAt: now,
    });
    await access.recordAudit(tx, ctx, {
      action: "event.created",
      entity: { type: "event", id },
      before: null,
      after: {
        kind: parsed.data.kind,
        slug: saved,
        status,
        title: parsed.data.title,
        startsAt: parsed.data.startsAt.toISOString(),
        endsAt: parsed.data.endsAt.toISOString(),
      },
      actorRole: role,
    });
    return saved;
  });
  return { ok: true, id, slug };
}

export async function getEventForAdmin(
  ctx: UseCaseContext,
  access: EventsAccess,
  input: { eventId: string }
): Promise<GetEventForAdminResult> {
  await access.authorize(ctx, "event.read_admin");
  const parsed = eventIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "not_found" };
  const [row] = await ctx.db
    .select()
    .from(event)
    .where(eq(event.id, parsed.data.eventId));
  return row
    ? { ok: true, event: adminEvent(row) }
    : { ok: false, error: "not_found" };
}

/** Every event, the latest start first. */
export async function listEventsForAdmin(
  ctx: UseCaseContext,
  access: EventsAccess
): Promise<AdminEvent[]> {
  await access.authorize(ctx, "event.read_admin");
  const rows = await ctx.db
    .select()
    .from(event)
    .orderBy(desc(event.startsAt), desc(event.id));
  return rows.map(adminEvent);
}
