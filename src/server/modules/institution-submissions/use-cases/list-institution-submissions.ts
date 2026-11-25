// listInstitutionSubmissions({ institutionId, reference }) (#87): the
// coordinator's submission roster for one institution registration. Every
// student enrolled in it, by name, with their registration number, their
// entry's Entry ID and status, and the next step (submit, replace, retry)
// or why there is none; counts by status; when submissions close; and
// whether the registration's conduct is certified. Names only: no date of
// birth and no contact details.
//
// Loads under plain Node: relative imports only, no "server-only".

import { asc, eq, inArray } from "drizzle-orm";

import { authorize } from "../../../access/can";
import {
  entry,
  entryFile,
  participantProfile,
  registration,
} from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import type { EntryFileStatus } from "../../entries/domain/status";
import { submissionWindows } from "../../entries/registration-facts";
import { institutionResource } from "../../institutions/coordinators/policy";
import { isConductCertified } from "../conduct";
import {
  buildSubmissionRoster,
  submissionGate,
  type RosterEntry,
  type SubmissionGate,
  type SubmissionRoster,
} from "../domain/roster";
import { loadRegistrationScope } from "../registration-scope";
import { registrationInput } from "./certify-conduct";

export type InstitutionSubmissions = {
  ok: true;
  reference: string;
  institutionId: string;
  institutionName: string;
  competitionName: string;
  gate: SubmissionGate;
  /** When submissions close; null while the competition has no such date. */
  closesAt: Date | null;
  conductCertified: boolean;
} & SubmissionRoster;

export type ListInstitutionSubmissionsResult =
  | InstitutionSubmissions
  | InvalidInput
  | { ok: false; error: "not_found" };

const IN_FLIGHT: ReadonlySet<EntryFileStatus> = new Set([
  "pending",
  "processing",
]);

export async function listInstitutionSubmissions(
  ctx: UseCaseContext,
  input: { institutionId: string; reference: string }
): Promise<ListInstitutionSubmissionsResult> {
  const parsed = registrationInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  await authorize(
    ctx,
    "institution_submissions.read",
    institutionResource(parsed.data.institutionId)
  );
  const scope = await loadRegistrationScope(ctx.db, parsed.data);
  if (!scope) return { ok: false, error: "not_found" };

  const students = await ctx.db
    .select({
      registrationId: registration.id,
      studentName: participantProfile.fullName,
      registrationNumber: registration.registrationNumber,
      registrationStatus: registration.status,
    })
    .from(registration)
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, registration.participantProfileId)
    )
    .where(eq(registration.institutionRegistrationId, scope.id))
    .orderBy(asc(registration.id));
  const entries = await rosterEntries(
    ctx,
    students.map((each) => each.registrationId)
  );
  const window =
    (await submissionWindows(ctx.db, [scope.competition.id])).get(
      scope.competition.id
    ) ?? null;
  const gate = submissionGate(
    scope.competition.digitalScope,
    window,
    ctx.clock.now()
  );

  return {
    ok: true,
    reference: scope.reference,
    institutionId: scope.institutionId,
    institutionName: scope.institutionName,
    competitionName: scope.competition.name,
    gate,
    closesAt: window?.closesAt ?? null,
    conductCertified: await isConductCertified(ctx.db, scope.id),
    ...buildSubmissionRoster({ students, entries, gate }),
  };
}

/** The entries of `registrationIds`, each with whether its newest upload is being checked. */
async function rosterEntries(
  ctx: UseCaseContext,
  registrationIds: readonly string[]
): Promise<RosterEntry[]> {
  if (registrationIds.length === 0) return [];
  const rows = await ctx.db
    .select({
      id: entry.id,
      registrationId: entry.registrationId,
      code: entry.code,
      status: entry.status,
    })
    .from(entry)
    .where(inArray(entry.registrationId, [...registrationIds]));
  if (rows.length === 0) return [];
  const files = await ctx.db
    .select({
      entryId: entryFile.entryId,
      status: entryFile.status,
    })
    .from(entryFile)
    .where(
      inArray(
        entryFile.entryId,
        rows.map((row) => row.id)
      )
    )
    .orderBy(asc(entryFile.attemptNumber));
  const newest = new Map(files.map((file) => [file.entryId, file.status]));
  return rows.map((row) => {
    const latest = newest.get(row.id);
    return {
      registrationId: row.registrationId,
      code: row.code,
      status: row.status,
      checking: latest !== undefined && IN_FLIGHT.has(latest),
    };
  });
}
