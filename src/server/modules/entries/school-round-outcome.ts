// Moving an entry for its school round's outcome (#89), for the school
// round module's finalising, inside its transaction with the entry locked:
// a shortlisted entry goes submitted → school_shortlisted (→
// submitted_to_foa under all-participants scope); any other becomes
// not_shortlisted. Each move is checked by the entry machine and written
// with one entry_transition row and one audit row, by the acting user.
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
  school_shortlisted: "school_shortlisted",
  submitted_to_foa: "sent_to_foa",
  not_shortlisted: "not_shortlisted",
};

/** Moves the locked entry from `from` through `statuses`, in order. */
export async function applySchoolRoundOutcome(
  tx: AppDb,
  ctx: { clock: Clock; actor: Actor },
  move: {
    entryId: string;
    from: EntryStatus;
    statuses: readonly EntryStatus[];
    actorRole: Role | null;
  }
): Promise<void> {
  let from = move.from;
  for (const to of move.statuses) {
    const trigger = TRIGGER[to];
    if (!trigger) throw new Error(`No school round move to ${to}`);
    await recordMove(tx, ctx, {
      entryId: move.entryId,
      from,
      to,
      trigger,
      entryFileId: null,
      actorRole: move.actorRole,
    });
    from = to;
  }
  await tx
    .update(entry)
    .set({ status: from, updatedAt: ctx.clock.now() })
    .where(eq(entry.id, move.entryId));
}
