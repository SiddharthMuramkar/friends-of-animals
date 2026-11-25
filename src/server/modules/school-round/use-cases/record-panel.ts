// recordPanel({ institutionId, reference, members }) (#89): the coordinator
// records who judged the school round, each member's full name and
// designation (HR-37: 1 to 10 members, no contact details). Saving again
// replaces the whole list. Only while the round is open.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";
import { z } from "zod";

import { schoolRound, schoolRoundPanelMember } from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import { nextRoundRowId } from "../store";
import { withLockedRound, type RoundRefusal } from "./editable-round";
import { roundInput } from "./get-school-round";

/** Most members a panel may list. */
export const PANEL_MAX_MEMBERS = 10;
/** Longest name or designation, after trimming. */
export const PANEL_FIELD_MAX = 120;

const text = z.string().trim().min(1).max(PANEL_FIELD_MAX);

const panelInput = roundInput.extend({
  members: z
    .array(z.object({ fullName: text, designation: text }))
    // Room to say "too many" rather than refuse the body.
    .max(50),
});

export type RecordPanelInput = z.input<typeof panelInput>;

export type RecordPanelResult =
  | { ok: true }
  | InvalidInput
  | RoundRefusal
  | { ok: false; error: "panel_empty" | "panel_too_large" };

export async function recordPanel(
  ctx: UseCaseContext,
  input: RecordPanelInput
): Promise<RecordPanelResult> {
  const parsed = panelInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { members, ...ref } = parsed.data;
  return withLockedRound(
    ctx,
    "school_round.manage",
    ref,
    async ({ tx, round }): Promise<RecordPanelResult> => {
      if (members.length === 0) return { ok: false, error: "panel_empty" };
      if (members.length > PANEL_MAX_MEMBERS) {
        return { ok: false, error: "panel_too_large" };
      }
      const now = ctx.clock.now();
      await tx
        .delete(schoolRoundPanelMember)
        .where(eq(schoolRoundPanelMember.roundId, round.id));
      await tx.insert(schoolRoundPanelMember).values(
        members.map((member, sortOrder) => ({
          id: nextRoundRowId(now),
          roundId: round.id,
          sortOrder,
          ...member,
        }))
      );
      await tx
        .update(schoolRound)
        .set({ updatedAt: now })
        .where(eq(schoolRound.id, round.id));
      return { ok: true };
    }
  );
}
