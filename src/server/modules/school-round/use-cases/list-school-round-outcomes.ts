// listSchoolRoundOutcomes({ registrationId } | { institutionRegistrationId })
// (#89): each entry's school round outcome, for one student's registration
// or for a whole institution registration. Results (M4 #100) and the
// coordinator read it. While the round is still open every outcome is
// `pending` and no draft pick or position shows; once finalised each entry
// is `shortlisted` (with its school position, if any) or `not_shortlisted`.
// `roundStatus` is null when no round opened.
//
// Who may read: the platform itself, a competition manager of that
// competition (or a global one), and the institution's coordinators and
// authorised person.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import type { ScopedScope } from "../../../access/domain/roles";
import {
  competition,
  institutionRegistration,
  registration,
} from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import type { SchoolRoundStatus } from "../domain/status";
import {
  loadPicks,
  loadRound,
  loadRoundEntries,
  loadRoundStudents,
} from "../store";

const outcomesInput = z.union([
  z.object({ registrationId: z.uuid() }).strict(),
  z.object({ institutionRegistrationId: z.uuid() }).strict(),
]);

export type ListSchoolRoundOutcomesInput =
  | { registrationId: string }
  | { institutionRegistrationId: string };

export type SchoolRoundOutcome = {
  registrationId: string;
  entryId: string | null;
  entryCode: string | null;
  outcome: "pending" | "shortlisted" | "not_shortlisted";
  /** The school position of a shortlisted entry, if it has one. */
  position: number | null;
};

export type ListSchoolRoundOutcomesResult =
  | {
      ok: true;
      roundStatus: SchoolRoundStatus | null;
      outcomes: SchoolRoundOutcome[];
    }
  | InvalidInput
  | { ok: false; error: "not_found" };

/** The statuses whose picks are the official shortlist. */
const DECIDED: readonly SchoolRoundStatus[] = ["finalised", "closed_on_behalf"];

export async function listSchoolRoundOutcomes(
  ctx: UseCaseContext,
  input: ListSchoolRoundOutcomesInput
): Promise<ListSchoolRoundOutcomesResult> {
  const parsed = outcomesInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const studentRegistrationId =
    "registrationId" in parsed.data ? parsed.data.registrationId : null;
  let institutionRegistrationId: string | null = null;
  if (studentRegistrationId) {
    const [student] = await ctx.db
      .select({ id: registration.institutionRegistrationId })
      .from(registration)
      .where(eq(registration.id, studentRegistrationId));
    institutionRegistrationId = student?.id ?? null;
  } else if ("institutionRegistrationId" in parsed.data) {
    institutionRegistrationId = parsed.data.institutionRegistrationId;
  }
  const [target] = institutionRegistrationId
    ? await ctx.db
        .select({
          id: institutionRegistration.id,
          institutionId: institutionRegistration.institutionId,
          competitionId: institutionRegistration.competitionId,
          digitalScope: competition.digitalScope,
        })
        .from(institutionRegistration)
        .innerJoin(
          competition,
          eq(competition.id, institutionRegistration.competitionId)
        )
        .where(eq(institutionRegistration.id, institutionRegistrationId))
    : [];
  // Unknown: only someone who could read any registration learns so.
  const scopes: ScopedScope[] = target
    ? [
        { type: "institution", id: target.institutionId },
        { type: "competition", id: target.competitionId },
      ]
    : [];
  await authorize(ctx, "school_round.outcomes.read", { scopes });
  if (!target) return { ok: false, error: "not_found" };

  const round = await loadRound(ctx.db, target.id);
  const entries = (await loadRoundEntries(ctx.db, target.id)).filter(
    (each) =>
      studentRegistrationId === null ||
      each.registrationId === studentRegistrationId
  );
  const decided = round !== null && DECIDED.includes(round.status);
  const positions = decided
    ? new Map(
        (await loadPicks(ctx.db, round.id)).map((pick) => [
          pick.entryId,
          pick.position,
        ])
      )
    : null;
  const outcomes = entries.map((each): SchoolRoundOutcome => {
    const base = {
      registrationId: each.registrationId,
      entryId: each.entryId,
      entryCode: each.code,
    };
    if (!positions) return { ...base, outcome: "pending", position: null };
    return positions.has(each.entryId)
      ? {
          ...base,
          outcome: "shortlisted",
          position: positions.get(each.entryId) ?? null,
        }
      : { ...base, outcome: "not_shortlisted", position: null };
  });
  if (target.digitalScope === "shortlist_only") {
    const withoutEntry = (await loadRoundStudents(ctx.db, target.id)).filter(
      (student) =>
        !student.entry &&
        (studentRegistrationId === null ||
          student.registrationId === studentRegistrationId)
    );
    for (const student of withoutEntry)
      outcomes.push({
        registrationId: student.registrationId,
        entryId: null,
        entryCode: null,
        outcome: decided ? "not_shortlisted" : "pending",
        position: null,
      });
  }
  return { ok: true, roundStatus: round?.status ?? null, outcomes };
}
