import type { UseCaseContext } from "../../use-cases";
import { lockUserSubject, subjectEvents } from "./repository";
import { currentConsent, decideWithdraw } from "./domain/consent-state";
import { appendConsentEvent } from "./consents";

/** Internal transaction, only called by the separately authorised and
 * validated own-auction and own-public-use withdrawal use cases. The
 * subject/giver is always the actor, never a caller-provided id. */
export async function withdrawOwnUse(
  ctx: UseCaseContext,
  competitionId: string,
  purpose: "auction" | "public_display" | "social_media"
) {
  if (ctx.actor.kind !== "user") throw new Error("Expected user");
  const userId = ctx.actor.userId;
  const subject = { type: "user" as const, id: userId };
  return ctx.db.transaction(async (tx) => {
    await lockUserSubject(tx, userId);
    const state = currentConsent(
      await subjectEvents(tx, subject, purpose, competitionId, userId)
    );
    const decision = decideWithdraw(state);
    if (decision.kind !== "record")
      return { ok: true, changed: false } as const;
    await appendConsentEvent(tx, ctx, state, {
      subject,
      giverUserId: userId,
      purpose,
      action: "withdrawn",
      documentId: decision.documentId,
      method: "web_form",
      competitionId,
    });
    return { ok: true, changed: true } as const;
  });
}
