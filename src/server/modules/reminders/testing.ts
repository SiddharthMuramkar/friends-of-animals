// Test helpers for the reminders module: a competition whose submissions
// close at 23:59 IST on 13 February 2027, registrants at every stage, and
// readers for what was planned and who was reminded. Tests only: nothing
// in the app imports this file.

import { and, asc, eq, getTableColumns } from "drizzle-orm";

import type { Actor } from "@/server/actor";
import {
  entry,
  inboxItem,
  outbox,
  participantProfile,
  registration,
  reminderJob,
  user,
} from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import {
  bornYearsBefore2027,
  registrants,
} from "@/server/modules/announcements/testing";
import type { EntryStatus } from "@/server/modules/entries/domain/status";
import { openToIndividuals } from "@/server/modules/participants/testing";
import type { DigitalScope } from "@/server/modules/competitions/domain/vocabulary";
import type { Harness } from "@/test/harness";

/** The worker, as it schedules and runs reminders. */
export const WORKER: Actor = { kind: "system", process: "worker" };

/** 23:59 IST on 13 February 2027: the test world's submission deadline. */
export const DEADLINE = new Date("2027-02-13T18:29:00.000Z");

/** How the default template writes DEADLINE. */
export const DEADLINE_WORDS = "13 February 2027 at 11:59 pm IST";

/** The instant `hours` before `deadline`. */
export function hoursBefore(hours: number, deadline: Date = DEADLINE): Date {
  return new Date(deadline.getTime() - hours * 60 * 60 * 1000);
}

/** The key dates, in IST as a manager types them, around DEADLINE. */
export const KEY_DATES = {
  registration_opens: "2027-01-01T09:00",
  registration_closes: "2027-02-05T23:59",
  submissions_close: "2027-02-13T23:59",
  school_round_closes: "2027-02-20T23:59",
};

/** A free competition with registration open, for everyone aged 5 to 99. */
export async function reminderCompetition(
  h: Harness,
  {
    name = "Paws for Thought",
    digitalScope = "all_participants",
  }: { name?: string; digitalScope?: DigitalScope } = {}
) {
  const competition = await openToIndividuals(h, {
    fee: 0n,
    name,
    digitalScope,
    ageGroups: [{ label: "Everyone", minAge: 5, maxAge: 99 }],
    keyDates: KEY_DATES,
  });
  return { ...competition, name };
}

/** Plans the competition's reminders, as the worker does after publishing. */
export async function scheduleFor(h: Harness, competitionId: string) {
  const scheduled = await h.as(WORKER).scheduleReminders({
    subjectType: "competition",
    subjectId: competitionId,
  });
  if (!scheduled.ok) throw new Error(JSON.stringify(scheduled));
  return scheduled;
}

/** The competition's reminder rows, soonest first. */
export function reminderRows(h: Harness, competitionId: string) {
  return h.db
    .select()
    .from(reminderJob)
    .where(
      and(
        eq(reminderJob.subjectId, competitionId),
        eq(reminderJob.reminderName, "entry_submission_due")
      )
    )
    .orderBy(asc(reminderJob.fireAt), asc(reminderJob.createdAt));
}

/** The pending `reminder.due` deliveries, soonest first. */
export function dueReminderEvents(h: Harness) {
  return h.db
    .select({ ...getTableColumns(outbox) })
    .from(outbox)
    .innerJoin(reminderJob, eq(reminderJob.id, outbox.aggregateId))
    .where(
      and(
        eq(outbox.eventType, "reminder.due"),
        eq(outbox.status, "pending"),
        eq(reminderJob.reminderName, "entry_submission_due")
      )
    )
    .orderBy(asc(outbox.availableAt));
}

/** The subject line of the submission reminder for `competition`. */
export function reminderSubject(competition = "Paws for Thought"): string {
  return `Reminder: submissions for ${competition} close on ${DEADLINE_WORDS}`;
}

/** Who received the submission reminder by email (from `since`), sorted. */
export function remindedByEmail(
  h: Harness,
  { since, competition }: { since?: Date; competition?: string } = {}
): string[] {
  return h.email.sent
    .filter(
      (message) =>
        message.subject === reminderSubject(competition) &&
        (since === undefined || message.sentAt >= since)
    )
    .map((message) => message.to.toLowerCase())
    .sort();
}

/** The address of each account with the reminder in its inbox, sorted. */
export async function remindedInApp(h: Harness): Promise<string[]> {
  const rows = await h.db
    .select({ email: user.email })
    .from(inboxItem)
    .innerJoin(user, eq(user.id, inboxItem.userId))
    .where(eq(inboxItem.templateKey, "reminders.entry_submission_due"));
  return rows.map((row) => row.email ?? "").sort();
}

/**
 * Gives a registration an entry in `status` directly. A school's student's
 * entry comes from its coordinator (#87), which this branch doesn't have
 * yet; individuals' tests upload through the entries use cases instead.
 */
export async function recordEntry(
  h: Harness,
  registrationId: string,
  status: EntryStatus
): Promise<void> {
  const [row] = await h.db
    .select({
      competitionId: registration.competitionId,
      profileId: registration.participantProfileId,
    })
    .from(registration)
    .where(eq(registration.id, registrationId));
  if (!row) throw new Error(`No registration ${registrationId}`);
  const now = h.clock.now();
  const id = uuidv7(now);
  await h.db.insert(entry).values({
    id,
    code: `PAWS27-E-${id.replaceAll("-", "").slice(-6).toUpperCase()}`,
    competitionId: row.competitionId,
    registrationId,
    participantProfileId: row.profileId,
    discipline: "drawing",
    title: "Our street dog",
    description: "The dog that sleeps by the school gate.",
    status,
    submittedAt: status === "submitted" ? now : null,
    createdAt: now,
    updatedAt: now,
  });
}

/** An adult's own registration for a competition. */
export async function ownRegistration(
  h: Harness,
  competitionId: string,
  account: { id: string }
): Promise<string> {
  const [row] = await h.db
    .select({ id: registration.id })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .where(
      and(
        eq(registration.competitionId, competitionId),
        eq(participantProfile.ownerKind, "self"),
        eq(participantProfile.ownerUserId, account.id)
      )
    );
  if (!row) throw new Error(`No registration of ${account.id}`);
  return row.id;
}

/** Hill School under its coordinator Meera, with two confirmed students. */
export function hillSchool(
  add: ReturnType<typeof registrants>,
  coordinators = [{ name: "Meera Iyer", email: "meera@example.test" }]
) {
  return add.school({
    name: "Hill School",
    coordinators,
    students: [
      {
        fullName: "Aanya Rao",
        dateOfBirth: bornYearsBefore2027(10),
        guardian: {
          name: "Kiran Rao",
          email: "kiran@example.test",
          phone: "+919000000303",
        },
        status: "confirmed",
      },
      {
        fullName: "Sana Khan",
        dateOfBirth: bornYearsBefore2027(19),
        email: "sana@example.test",
        phone: "+919000000202",
        status: "confirmed",
      },
    ],
  });
}

/**
 * The #84 brief's Seam 1 world on one competition, kept small: Asha, an
 * adult without an entry, and Kavita, whose 10-year-old Isha has none
 * either. With `school`, Hill School too, whose students have no entries.
 */
export async function reminderWorld(
  h: Harness,
  options: { digitalScope?: DigitalScope; school?: boolean } = {}
) {
  const competition = await reminderCompetition(h, options);
  const add = registrants(h, competition);
  const asha = await add.adult({
    name: "Asha Rao",
    email: "asha@example.test",
  });
  const desai = await add.child({
    guardian: { name: "Kavita Desai", email: "kavita@example.test" },
    child: { fullName: "Isha Desai", age: 10 },
  });
  const school = options.school ? await hillSchool(add) : null;
  // The set-up's own messages (receipts, the school's verification) first.
  await h.drain();
  return {
    competition,
    competitionId: competition.id,
    add,
    asha,
    desai,
    school,
    registrationOf: (account: { id: string }) =>
      ownRegistration(h, competition.id, account),
  };
}
