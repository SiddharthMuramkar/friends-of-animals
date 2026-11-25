// The coordinator and manager both apply the same shortlist-only outcomes.
import type { AppDb } from "../../db/app-db";
import { planShortlistOnlyOutcomes } from "./domain/shortlist-only";
import { loadRoundStudents, type RoundEntry } from "./store";

export async function planShortlistOnlyRound(
  tx: AppDb,
  institutionRegistrationId: string,
  entries: readonly RoundEntry[]
) {
  const students = await loadRoundStudents(tx, institutionRegistrationId);
  const byEntry = new Map(
    students.flatMap((student) =>
      student.entry ? [[student.entry.entryId, student.entry] as const] : []
    )
  );
  return planShortlistOnlyOutcomes({
    enrolments: students.map((student) => ({
      registrationId: student.registrationId,
      confirmed: true,
    })),
    entries: entries.map((each) => ({
      entryId: each.entryId,
      registrationId: each.registrationId,
      fileLive: byEntry.get(each.entryId)?.hasLiveFile ?? false,
      position: byEntry.get(each.entryId)?.position ?? null,
    })),
  });
}
