// Returning a resubmitted entry to FOA once its new file is live (#92), by
// the outbox handler verification.return_resubmission after
// entry.replacement_live. A sent-back entry resubmitted with a new file
// stays sent back while the file is checked; when it goes live the entry
// returns to FOA, even if that happens after the resubmission deadline
// (the upload was completed before it). A replacement that goes live on an
// entry with no resubmission waiting, or a repeated delivery, changes
// nothing.
//
// Loads under plain Node (the worker): relative imports only.

import type { AppDb } from "../../db/app-db";
import type { Clock } from "../../ports/clock";
import { lockEntry } from "../entries/store";
import { applyVerificationMove } from "../entries/verification-move";
import { decide } from "./domain/decide";
import {
  latestVerification,
  lockRoundOf,
  routeOfEntry,
  verificationStateOf,
  WORKER,
} from "./store";

export async function returnResubmission(
  deps: { db: AppDb; clock: Clock },
  payload: { entryId: string; entryFileId: string }
): Promise<void> {
  const ctx = { clock: deps.clock, actor: WORKER };
  await deps.db.transaction(async (tx) => {
    const route = await routeOfEntry(tx, { entryId: payload.entryId });
    if (!route) return;
    await lockRoundOf(tx, route);
    const locked = await lockEntry(tx, payload.entryId);
    if (!locked) return;
    const latest = await latestVerification(tx, payload.entryId);
    const decision = decide(
      verificationStateOf(locked.row.status, latest),
      { kind: "replacement_live" },
      deps.clock.now()
    );
    if (!decision.ok || decision.to !== "submitted_to_foa") return;
    await applyVerificationMove(tx, ctx, {
      entryId: payload.entryId,
      from: locked.row.status,
      to: "submitted_to_foa",
      actorRole: null,
      entryFileId: payload.entryFileId,
      details: { verificationId: latest?.id ?? null, withFile: true },
    });
  });
}
