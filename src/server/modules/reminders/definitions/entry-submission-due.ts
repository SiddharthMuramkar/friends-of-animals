// entry_submission_due (#84): before a competition's submissions close
// (its `submissions_close` key date), whoever still owes an entry is
// reminded. A confirmed registration owes one while it has no entry, or
// only one whose upload was rejected or failed; one still being checked
// (`processing`) counts as made (HR-37).
//
// An individual's reminder goes to the adult, or to a minor's guardians.
// A school's students are submitted by its coordinators (#87), and only
// while the competition takes every participant's work digitally
// (`all_participants`): each coordinator of a school with a student who
// owes one gets one reminder per run. Under `shortlist_only`, school
// students owe nothing here; #90's shortlist reminder covers schools.
//
// Loads under plain Node (the worker): relative imports only.

import { and, eq, gt, inArray, isNull, notInArray, or } from "drizzle-orm";

import type { AppDb } from "../../../db/app-db";
import {
  competition,
  competitionKeyDate,
  entry,
  registration,
} from "../../../db/schema";
import type { CompetitionStatus } from "../../competitions/domain/vocabulary";
import type { ReminderDefinition } from "../registry";

/** Statuses before any deadline applies: none is planned for them. */
const NOT_LIVE: readonly CompetitionStatus[] = ["draft"];

/** A competition in these statuses may still take submissions. */
const TAKING_SUBMISSIONS: CompetitionStatus[] = [
  "published",
  "registration_open",
  "registration_closed",
];

export const entrySubmissionDue: ReminderDefinition = {
  name: "entry_submission_due",
  subjectType: "competition",
  offsetSettings: [
    "reminders.entrySubmissionDueFirstHours",
    "reminders.entrySubmissionDueSecondHours",
  ],
  templateKey: "reminders.entry_submission_due",
  variables: ["competition.name"],

  async deadlineOf(db, competitionId) {
    const [row] = await db
      .select({ status: competition.status, at: competitionKeyDate.at })
      .from(competition)
      .leftJoin(
        competitionKeyDate,
        and(
          eq(competitionKeyDate.competitionId, competition.id),
          eq(competitionKeyDate.kind, "submissions_close")
        )
      )
      .where(eq(competition.id, competitionId));
    if (!row || NOT_LIVE.includes(row.status)) return { kind: "none" };
    if (row.status === "cancelled") return { kind: "cancelled" };
    return row.at ? { kind: "open", at: row.at } : { kind: "none" };
  },

  async subjectsToSync(db, now) {
    const rows = await db
      .select({ id: competition.id })
      .from(competition)
      .innerJoin(
        competitionKeyDate,
        and(
          eq(competitionKeyDate.competitionId, competition.id),
          eq(competitionKeyDate.kind, "submissions_close")
        )
      )
      .where(
        and(
          inArray(competition.status, TAKING_SUBMISSIONS),
          gt(competitionKeyDate.at, now)
        )
      );
    return rows.map((row) => row.id);
  },

  async owes(db, { subjectId }) {
    const rows = await debtors(db, subjectId);
    const of = (route: "individual" | "institution") =>
      new Set(rows.filter((row) => row.route === route).map((row) => row.id));
    return {
      kind: "competition_roster",
      competitionId: subjectId,
      groups: [
        { registrationIds: of("individual"), roles: ["participant", "guardian"] },
        { registrationIds: of("institution"), roles: ["coordinator"] },
      ],
    };
  },

  async values(db, competitionId): Promise<Record<string, string>> {
    const [row] = await db
      .select({ name: competition.name })
      .from(competition)
      .where(eq(competition.id, competitionId));
    return row ? { "competition.name": row.name } : {};
  },
};

/** The confirmed registrations still without an entry that counts. */
function debtors(db: AppDb, competitionId: string) {
  return db
    .select({ id: registration.id, route: registration.route })
    .from(registration)
    .innerJoin(competition, eq(competition.id, registration.competitionId))
    .leftJoin(entry, eq(entry.registrationId, registration.id))
    .where(
      and(
        eq(registration.competitionId, competitionId),
        eq(registration.status, "confirmed"),
        or(isNull(entry.id), inArray(entry.status, ["rejected", "failed"])),
        or(
          eq(registration.route, "individual"),
          eq(competition.digitalScope, "all_participants")
        ),
        notInArray(competition.status, ["draft", "cancelled"])
      )
    );
}
