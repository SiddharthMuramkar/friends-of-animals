// resubmitEntry({ entryId, title?, description?, statement? }) (#92): the
// participant or their guardian (individual route), or the student's
// coordinator (school route), resubmits a sent-back entry without a new
// file, before its resubmission deadline: the entry returns to FOA
// (sent_back → submitted_to_foa, owner decision 2026-11-19: no separate
// resubmitted status) and waits for a verifier again. New words, if given,
// replace the entry's.
//
// A resubmission with a new file goes through the entries module's upload
// (startEntryUpload, completeEntryUpload or submitEssayText), which takes a
// sent-back entry's file until its deadline and records the resubmission;
// the entry returns once that file is live (../return-resubmission.ts).
// While such a file is still being checked this use case refuses
// (`upload_in_progress`), so the verifier never sees work change under
// them.
//
// Loads under plain Node: relative imports only, no "server-only".

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { entry } from "../../../db/schema";
import { DomainError } from "../../../errors";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import { ENTRY_TEXT_LIMITS } from "../../entries/domain/entry-text";
import { authorizeEntrySubmission } from "../../entries/registration-facts";
import { lockEntry } from "../../entries/store";
import { applyVerificationMove } from "../../entries/verification-move";
import { decide, type VerificationRefusal } from "../domain/decide";
import {
  latestVerification,
  lockRoundOf,
  recordResubmission,
  routeOfEntry,
  verificationStateOf,
} from "../store";

const words = (max: number) => z.string().trim().min(1).max(max);

const resubmitInput = z
  .object({
    entryId: z.uuid(),
    title: words(ENTRY_TEXT_LIMITS.title).optional(),
    description: words(ENTRY_TEXT_LIMITS.description).optional(),
    statement: z.string().trim().max(ENTRY_TEXT_LIMITS.statement).optional(),
  })
  // New words come together: a title without its description is a mistake.
  .refine(
    (input) => (input.title === undefined) === (input.description === undefined),
    { path: ["description"] }
  );

export type ResubmitEntryInput = z.input<typeof resubmitInput>;

export type ResubmitEntryResult =
  | { ok: true; status: "submitted_to_foa" }
  | InvalidInput
  | {
      ok: false;
      error:
        | Extract<
            VerificationRefusal,
            "not_sent_back" | "resubmission_closed" | "already_verified"
          >
        | "upload_in_progress";
    };

export async function resubmitEntry(
  ctx: UseCaseContext,
  input: ResubmitEntryInput
): Promise<ResubmitEntryResult> {
  await authorize(ctx, "entry.access");
  const parsed = resubmitInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { entryId, title, description, statement } = parsed.data;
  const route = await routeOfEntry(ctx.db, { entryId });
  if (!route) {
    throw new DomainError("forbidden", "No entry the actor may resubmit");
  }
  // The entries module's own rule: the owner or their guardian, or the
  // student's institution. A verifier, another family or another school
  // is refused here.
  const { role } = await authorizeEntrySubmission(ctx, route.registrationId);
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const userId = ctx.actor.userId;

  return ctx.db.transaction(async (tx): Promise<ResubmitEntryResult> => {
    await lockRoundOf(tx, route);
    const locked = await lockEntry(tx, entryId);
    if (!locked) throw new Error("unreachable: entry vanished");
    if (
      locked.files.some(
        (file) => file.status === "pending" || file.status === "processing"
      )
    ) {
      return { ok: false, error: "upload_in_progress" };
    }
    const latest = await latestVerification(tx, entryId);
    const now = ctx.clock.now();
    const decision = decide(
      verificationStateOf(locked.row.status, latest),
      { kind: "resubmit", withNewFile: false },
      now
    );
    if (!decision.ok) {
      return {
        ok: false,
        error:
          decision.code === "resubmission_closed" ||
          decision.code === "already_verified"
            ? decision.code
            : "not_sent_back",
      };
    }
    if (decision.to !== "submitted_to_foa" || !latest) {
      throw new Error("unreachable: a resubmission without a file returns");
    }
    if (title !== undefined && description !== undefined) {
      await tx
        .update(entry)
        .set({ title, description, statement: statement || null })
        .where(eq(entry.id, entryId));
    }
    await recordResubmission(tx, {
      verificationId: latest.id,
      at: now,
      userId,
      withFile: false,
    });
    await applyVerificationMove(tx, ctx, {
      entryId,
      from: locked.row.status,
      to: "submitted_to_foa",
      actorRole: role,
      details: {
        verificationId: latest.id,
        withFile: false,
        wordsChanged: title !== undefined,
      },
    });
    return { ok: true, status: "submitted_to_foa" };
  });
}
