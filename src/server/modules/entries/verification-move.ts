// Moving an entry for FOA verification (#92), for the verification module,
// inside its transaction with the entry locked: forwarded to FOA, verified,
// sent back, or resubmitted. The entry machine checks each move, and each
// is written with one entry_transition row and one audit row, so the
// entries module stays the only writer of an entry's status.
//
// Loads under plain Node: relative imports only.

import { eq } from "drizzle-orm";

import type { Role } from "../../access/domain/roles";
import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import { entry } from "../../db/schema";
import type { Clock } from "../../ports/clock";
import type { EntryStatus, EntryTrigger } from "./domain/status";
import { recordMove } from "./store";

const TRIGGER: Partial<Record<EntryStatus, EntryTrigger>> = {
  foa_verified: "foa_verified",
  sent_back: "sent_back",
};

/** The trigger for a move into `to` from `from`. */
function triggerOf(
  from: EntryStatus,
  to: EntryStatus,
  entryFileId: string | null
): EntryTrigger {
  if (to === "submitted_to_foa") {
    if (from !== "sent_back") return "forwarded_to_foa";
    return entryFileId ? "resubmission_live" : "resubmitted";
  }
  const trigger = TRIGGER[to];
  if (!trigger) throw new Error(`No verification move to ${to}`);
  return trigger;
}

/** Moves the locked entry from `from` to `to` and records why. */
export async function applyVerificationMove(
  tx: AppDb,
  ctx: { clock: Clock; actor: Actor },
  move: {
    entryId: string;
    from: EntryStatus;
    to: EntryStatus;
    actorRole: Role | null;
    /** The file whose going live returned it, for a resubmission with one. */
    entryFileId?: string | null;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  await recordMove(tx, ctx, {
    entryId: move.entryId,
    from: move.from,
    to: move.to,
    trigger: triggerOf(move.from, move.to, move.entryFileId ?? null),
    entryFileId: move.entryFileId ?? null,
    actorRole: move.actorRole,
    ...(move.details ? { details: move.details } : {}),
  });
  await tx
    .update(entry)
    .set({ status: move.to, updatedAt: ctx.clock.now() })
    .where(eq(entry.id, move.entryId));
}
