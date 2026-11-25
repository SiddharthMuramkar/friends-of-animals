// Every place-changing operation locks the event first. The same lock
// serializes booking, cancellation, promotion, edits, check-in and closing.
import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  event,
  eventRegistration,
  guardian,
  guardianLink,
  participantProfile,
  user,
  type EventRegistrationRow,
  type EventRow,
} from "../../db/schema";
import { DomainError } from "../../errors";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import { emit } from "../../outbox";
import type { UseCaseContext } from "../../use-cases";
import {
  communityMemberFor,
  childKeys,
  personKeys,
  type Subject,
} from "../community";
import {
  belongsTo,
  subjectColumns,
  subjectOf,
  lockPerson,
} from "../community/subjects";
import { targetSubject } from "../community/membership";
import { verifiedLink } from "../guardians/child-access";
import { applicantProfileOf } from "../volunteers/application-record";
import { ageAt } from "../participants/domain/age";
import { canMoveRegistration } from "./domain/registration-status";
import { registrationWindow } from "./domain/registration-window";
import { placeForNewRegistration, planPromotions } from "./domain/waitlist";
import {
  eventRows,
  lockEvent,
  placesTaken,
  position,
  publicView,
  waiting,
} from "./repository";
import type { EventId } from "./admin";

export type RegisterInput = { eventId: string; childId?: string };
export type RegistrationId = { registrationId: string };
const registerSchema = z.object({
  eventId: z.uuid(),
  childId: z.uuid().optional(),
});
const registrationSchema = z.object({ registrationId: z.uuid() });
const idSchema = z.object({ eventId: z.uuid() });
const childSchema = z.object({ childId: z.uuid().optional() });

function userId(ctx: UseCaseContext) {
  if (ctx.actor.kind !== "user")
    throw new DomainError("forbidden", "Sign in to register");
  return ctx.actor.userId;
}
async function readKeys(ctx: UseCaseContext, childId?: string) {
  const subject = await targetSubject(ctx, { childId });
  return subject.kind === "user"
    ? personKeys(ctx.db, subject.userId)
    : childKeys(ctx.db, subject.profileId);
}
async function currentGuardian(tx: AppDb, account: string, profileId: string) {
  const [linked] = await tx
    .select({ id: guardianLink.id })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .where(
      and(
        eq(guardian.userId, account),
        eq(guardianLink.participantProfileId, profileId),
        verifiedLink()
      )
    )
    .for("no key update", { of: guardianLink });
  return !!linked;
}
async function guardianOwns(tx: AppDb, account: string, keys: Subject[]) {
  for (const key of keys)
    if (
      key.kind === "profile" &&
      (await currentGuardian(tx, account, key.profileId))
    )
      return true;
  return false;
}
export async function registerForEvent(
  ctx: UseCaseContext,
  input: RegisterInput
) {
  const { role } = await authorize(ctx, "event.register");
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const actorId = userId(ctx);
  return ctx.db.transaction(async (db) => {
    const local = { ...ctx, db };
    const row = await lockEvent(db, parsed.data.eventId);
    const now = ctx.clock.now();
    if (
      !row ||
      registrationWindow(row, now).state !== "open" ||
      +now >= +row.endsAt
    )
      return { ok: false, error: "registration_not_open" } as const;
    const subject = await targetSubject(local, {
      childId: parsed.data.childId,
    });
    await lockPerson(db, subject);
    await targetSubject(local, { childId: parsed.data.childId }, "write");
    // Linked teenagers must register through a verified guardian. An ordinary
    // adult account without a participant profile may join a community event.
    if (subject.kind === "user") {
      const profile = await applicantProfileOf(db, ctx.cipher, actorId);
      if (profile && ageAt(profile.dateOfBirth, now) < 18)
        return { ok: false, error: "guardian_required" } as const;
    }
    if (
      row.audience === "members" &&
      (await communityMemberFor(db, subject))?.status !== "active"
    )
      return { ok: false, error: "members_only" } as const;
    const keys =
      subject.kind === "user"
        ? await personKeys(db, subject.userId)
        : await childKeys(db, subject.profileId);
    const [duplicate] = await db
      .select({ id: eventRegistration.id })
      .from(eventRegistration)
      .where(
        and(
          eq(eventRegistration.eventId, row.id),
          ne(eventRegistration.status, "cancelled"),
          belongsTo(keys, eventRegistration)
        )
      )
      .limit(1);
    if (duplicate) return { ok: false, error: "already_registered" } as const;
    // FIFO: a newly freed place never jumps over an existing waiter.
    await promoteWaitlist(db, local, row);
    const rows = await eventRows(db, row.id);
    const decision = placeForNewRegistration({
      capacity: row.capacity,
      placesTaken: placesTaken(rows),
      waiting: waiting(rows).length,
      waitlistEnabled: row.waitlistEnabled,
    });
    if ("refused" in decision)
      return { ok: false, error: decision.refused } as const;
    const registrationId = uuidv7(now);
    await db.insert(eventRegistration).values({
      id: registrationId,
      eventId: row.id,
      ...subjectColumns(subject),
      registeredByUserId: actorId,
      status: decision.status,
      registeredAt: now,
      waitlistedAt: decision.status === "waitlisted" ? now : null,
      waitlistOrder:
        decision.status === "waitlisted"
          ? 1 + rows.reduce((max, r) => Math.max(max, r.waitlistOrder ?? 0), 0)
          : null,
      updatedAt: now,
    });
    await recordAudit(db, local, {
      action: "event_registration.created",
      entity: { type: "event_registration", id: registrationId },
      before: null,
      after: { eventId: row.id, status: decision.status },
      actorRole: role,
    });
    await emit(db, ctx.clock, {
      type: "event.registration_created",
      aggregate: { type: "event_registration", id: registrationId },
      payload: { registrationId, status: decision.status },
    });
    return {
      ok: true,
      registrationId,
      status: decision.status,
      position:
        decision.status === "waitlisted"
          ? position(await eventRows(db, row.id), registrationId)
          : null,
    } as const;
  });
}

export async function promoteWaitlist(
  db: AppDb,
  ctx: Pick<UseCaseContext, "actor" | "clock">,
  row: EventRow
) {
  const now = ctx.clock.now();
  // A waiting attendee can still use a freed place while the event runs,
  // even when applications for new registrations have closed.
  if (row.status !== "published" || +now >= +row.endsAt) return;
  const rows = await eventRows(db, row.id);
  const promote = planPromotions({
    capacity: row.capacity,
    placesTaken: placesTaken(rows),
    waitlist: waiting(rows),
  });
  for (const registrationId of promote) {
    await db
      .update(eventRegistration)
      .set({ status: "registered", promotedAt: now, updatedAt: now })
      .where(eq(eventRegistration.id, registrationId));
    await recordAudit(db, ctx, {
      action: "event_registration.promoted",
      entity: { type: "event_registration", id: registrationId },
      before: { status: "waitlisted" },
      after: { status: "registered" },
      actorRole: null,
    });
    await emit(db, ctx.clock, {
      type: "event.waitlist_promoted",
      aggregate: { type: "event_registration", id: registrationId },
      payload: { registrationId },
    });
  }
}
export async function lockRegistrationEvent(db: AppDb, registrationId: string) {
  const [peek] = await db
    .select({ id: eventRegistration.eventId })
    .from(eventRegistration)
    .where(eq(eventRegistration.id, registrationId));
  if (!peek) return null;
  const row = await lockEvent(db, peek.id);
  const [registration] = await db
    .select()
    .from(eventRegistration)
    .where(eq(eventRegistration.id, registrationId))
    .for("update");
  return row && registration ? { row, registration } : null;
}
export async function cancelEventRegistration(
  ctx: UseCaseContext,
  input: RegistrationId
) {
  const parsed = registrationSchema.safeParse(input);
  // Unknown or malformed ids are not evidence of ownership.
  if (!parsed.success) {
    await authorize(ctx, "event.registration.cancel");
    return invalidInput(parsed.error);
  }
  return ctx.db.transaction(async (db) => {
    const local = { ...ctx, db };
    const found = await lockRegistrationEvent(db, parsed.data.registrationId);
    let ownerId: string | undefined;
    if (found && ctx.actor.kind === "user") {
      const account = ctx.actor.userId;
      const subject = subjectOf(found.registration);
      const keys =
        subject.kind === "user"
          ? await personKeys(db, subject.userId)
          : await childKeys(db, subject.profileId);
      if (
        keys.some((key) => key.kind === "user" && key.userId === account) ||
        (await guardianOwns(db, account, keys))
      )
        ownerId = account;
    }
    const { role } = await authorize(local, "event.registration.cancel", {
      ownerId,
    });
    if (!found) return { ok: false, error: "not_found" } as const;
    const { row, registration } = found;
    const now = ctx.clock.now();
    if (
      row.status !== "published" ||
      +now >= +row.endsAt ||
      !canMoveRegistration(registration.status, "cancelled")
    )
      return { ok: false, error: "invalid_transition" } as const;
    await db
      .update(eventRegistration)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(eq(eventRegistration.id, registration.id));
    await recordAudit(db, ctx, {
      action: "event_registration.cancelled",
      entity: { type: "event_registration", id: registration.id },
      before: { status: registration.status },
      after: { status: "cancelled" },
      actorRole: role,
    });
    await emit(db, ctx.clock, {
      type: "event.registration_cancelled",
      aggregate: { type: "event_registration", id: registration.id },
      payload: { registrationId: registration.id },
    });
    await promoteWaitlist(db, local, row);
    return { ok: true } as const;
  });
}
export async function listMyEventRegistrations(
  ctx: UseCaseContext,
  input: { childId?: string } = {}
) {
  await authorize(ctx, "event.my_registrations");
  const parsed = childSchema.safeParse(input);
  if (!parsed.success) throw new DomainError("forbidden", "Unknown child");
  const keys = await readKeys(ctx, parsed.data.childId);
  const rows = await ctx.db
    .select({ registration: eventRegistration, event })
    .from(eventRegistration)
    .innerJoin(event, eq(event.id, eventRegistration.eventId))
    .where(belongsTo(keys, eventRegistration))
    .orderBy(asc(event.startsAt), asc(eventRegistration.id));
  return Promise.all(
    rows.map(async ({ registration: r, event: row }) => {
      const all = await eventRows(ctx.db, row.id);
      return {
        id: r.id,
        status: r.status,
        registeredAt: r.registeredAt,
        promotedAt: r.promotedAt,
        checkedInAt: r.checkedInAt,
        position: position(all, r.id),
        event: publicView(row, ctx.clock.now(), placesTaken(all)),
      };
    })
  );
}
export async function listEventRegistrations(
  ctx: UseCaseContext,
  input: EventId
) {
  await authorize(ctx, "event.admin");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const rows = await ctx.db
    .select({
      registration: eventRegistration,
      userName: user.name,
      profileName: participantProfile.fullName,
    })
    .from(eventRegistration)
    .leftJoin(user, eq(user.id, eventRegistration.subjectUserId))
    .leftJoin(
      participantProfile,
      eq(participantProfile.id, eventRegistration.subjectProfileId)
    )
    .where(eq(eventRegistration.eventId, parsed.data.eventId))
    .orderBy(asc(eventRegistration.registeredAt), asc(eventRegistration.id));
  const all = rows.map((r) => r.registration);
  return {
    ok: true,
    items: rows.map(({ registration: r, userName, profileName }) => ({
      id: r.id,
      name: profileName ?? userName ?? "",
      status: r.status,
      registeredAt: r.registeredAt,
      waitlistedAt: r.waitlistedAt,
      promotedAt: r.promotedAt,
      checkedInAt: r.checkedInAt,
      position: position(all, r.id),
    })),
  } as const;
}
export async function getEventPlaces(ctx: UseCaseContext, input: EventId) {
  await authorize(ctx, "event.admin");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const [row] = await ctx.db
    .select()
    .from(event)
    .where(eq(event.id, parsed.data.eventId));
  if (!row) return { ok: false, error: "not_found" } as const;
  const rows = await eventRows(ctx.db, row.id);
  return {
    ok: true,
    capacity: row.capacity,
    placesTaken: placesTaken(rows),
    waiting: waiting(rows).length,
  } as const;
}

export async function refillPlaces(
  ctx: Pick<UseCaseContext, "actor" | "clock" | "db">,
  eventId: string
) {
  await authorize(ctx, "event.end");
  await ctx.db.transaction(async (db) => {
    const row = await lockEvent(db, eventId);
    if (row) await promoteWaitlist(db, ctx, row);
  });
}
