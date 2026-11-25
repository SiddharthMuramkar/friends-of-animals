// The file outcome handler runs this after the entry-file update commits.
// Lock round before entry (the same order as finalising), so either the
// finalisation or the live file promotes the entry, whichever comes last.
import { eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { competition, entry, registration } from "../../db/schema";
import type { Clock } from "../../ports/clock";
import { lockRegistrationStatus } from "../entries/registration-facts";
import { applySchoolRoundOutcome } from "../entries/school-round-outcome";
import { lockEntry, WORKER } from "../entries/store";
import { shortlistOnlyReadiness } from "./domain/shortlist-only";
import { isSchoolRoundFinished } from "./domain/status";
import { loadRound } from "./store";

export async function promoteShortlistedEntry(
  deps: { db: AppDb; clock: Clock },
  entryId: string
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const [facts] = await tx
      .select({
        scope: competition.digitalScope,
        competitionStatus: competition.status,
        registrationId: registration.id,
        institutionRegistrationId: registration.institutionRegistrationId,
      })
      .from(entry)
      .innerJoin(registration, eq(registration.id, entry.registrationId))
      .innerJoin(competition, eq(competition.id, entry.competitionId))
      .where(eq(entry.id, entryId))
      .for("share", { of: competition });
    if (
      facts?.scope !== "shortlist_only" ||
      facts.competitionStatus === "cancelled" ||
      !facts.institutionRegistrationId
    )
      return;
    const round = await loadRound(tx, facts.institutionRegistrationId, {
      lock: true,
    });
    if (!round) return;
    if (
      (await lockRegistrationStatus(tx, facts.registrationId)) !== "confirmed"
    )
      return;
    const locked = await lockEntry(tx, entryId);
    if (!locked) return;
    const readiness = shortlistOnlyReadiness({
      scope: facts.scope,
      status: locked.row.status,
      fileLive: locked.files.some((file) => file.status === "live"),
      roundFinished: isSchoolRoundFinished(round.status),
    });
    if (readiness.kind !== "promote") return;
    await applySchoolRoundOutcome(
      tx,
      { clock: deps.clock, actor: WORKER },
      {
        entryId,
        from: locked.row.status,
        statuses: ["submitted_to_foa"],
        actorRole: null,
      }
    );
  });
}
