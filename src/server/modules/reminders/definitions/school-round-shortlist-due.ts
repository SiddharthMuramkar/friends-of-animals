// #90: remind only coordinators of schools whose rounds are unfinished.
// Like the submission reminder, it uses the shared deadline and offset
// scheduling mechanism and reaches each coordinator just once per run.
import { and, eq, gt, isNull, ne, or, inArray } from "drizzle-orm";
import {
  competition,
  competitionKeyDate,
  institutionRegistration,
  registration,
  schoolRound,
} from "../../../db/schema";
import type { ReminderDefinition } from "../registry";

export const schoolRoundShortlistDue: ReminderDefinition = {
  name: "school_round_shortlist_due",
  subjectType: "competition",
  offsetSettings: [
    "reminders.schoolRoundShortlistDueFirstHours",
    "reminders.schoolRoundShortlistDueSecondHours",
  ],
  templateKey: "reminders.school_round_shortlist_due",
  variables: ["competition.name"],
  async deadlineOf(db, competitionId) {
    const [row] = await db
      .select({
        status: competition.status,
        participation: competition.participation,
        at: competitionKeyDate.at,
      })
      .from(competition)
      .leftJoin(
        competitionKeyDate,
        and(
          eq(competitionKeyDate.competitionId, competition.id),
          eq(competitionKeyDate.kind, "school_round_closes")
        )
      )
      .where(eq(competition.id, competitionId));
    if (!row) return { kind: "none" };
    if (row.status === "cancelled") return { kind: "cancelled" };
    return row.status !== "draft" &&
      row.participation !== "individuals" &&
      row.at
      ? { kind: "open", at: row.at }
      : { kind: "none" };
  },
  async subjectsToSync(db, now) {
    const rows = await db
      .select({ id: competition.id })
      .from(competition)
      .innerJoin(
        competitionKeyDate,
        and(
          eq(competitionKeyDate.competitionId, competition.id),
          eq(competitionKeyDate.kind, "school_round_closes")
        )
      )
      .where(
        and(
          ne(competition.participation, "individuals"),
          inArray(competition.status, [
            "published",
            "registration_open",
            "registration_closed",
            "school_judging",
          ]),
          gt(competitionKeyDate.at, now)
        )
      );
    return rows.map((row) => row.id);
  },
  async owes(db, { subjectId }) {
    const rows = await db
      .select({ id: registration.id })
      .from(registration)
      .innerJoin(
        institutionRegistration,
        eq(registration.institutionRegistrationId, institutionRegistration.id)
      )
      .leftJoin(
        schoolRound,
        eq(schoolRound.institutionRegistrationId, institutionRegistration.id)
      )
      .where(
        and(
          eq(registration.competitionId, subjectId),
          eq(registration.route, "institution"),
          eq(registration.status, "confirmed"),
          eq(institutionRegistration.status, "active"),
          or(
            isNull(schoolRound.status),
            inArray(schoolRound.status, ["open", "overdue"])
          )
        )
      );
    return {
      kind: "competition_roster",
      competitionId: subjectId,
      groups: [
        {
          registrationIds: new Set(rows.map((row) => row.id)),
          roles: ["coordinator"],
        },
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
