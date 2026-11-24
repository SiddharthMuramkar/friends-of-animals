// A campaign message's withdrawal link (#126), at /withdraw/<token>:
//
//   viewWithdrawalLink({ token }) → what withdrawing would stop, or that it
//                                   is done; opening it changes nothing
//   withdrawByLink({ token })     → withdraws every consent the message
//                                   rested on that is still given
//
// The token is the bearer credential: whoever holds the link acts for the
// person it was sent to, signed in or not. Withdrawing goes through the
// consent module's event log (ADR 0009), so the person is out of every later
// segment, and of this campaign's messages still waiting. A child's consent
// is withdrawn only while the recipient still looks after the child.
// Withdrawing more than one campaign's worth is the safe side: consent can
// always be given again.

import { eq } from "drizzle-orm";

import { authorize } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import { hashLinkToken } from "../../../crypto/link-token";
import type { AppDb } from "../../../db/app-db";
import { campaignRecipient, type CampaignRecipientRow } from "../../../db/schema";
import type { UseCaseContext } from "../../../use-cases";
import { withdrawByMessageLink } from "../../consent";
import { basisHolds } from "../domain/audience";
import { checksFor } from "../deliver";
import { isWellFormedWithdrawalToken } from "../withdrawal-link";

export type WithdrawalLinkView =
  | {
      ok: true;
      status: "open";
      /** The recipient's own consent to News and updates is still given. */
      ownConsent: boolean;
      /** Children whose consent to messages about them is still given. */
      children: number;
    }
  | { ok: true; status: "done" }
  | { ok: false; error: "not_found" };

export type WithdrawByLinkResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: "not_found" };

async function recipientByToken(
  db: AppDb,
  token: unknown,
  lock = false
): Promise<CampaignRecipientRow | null> {
  if (!isWellFormedWithdrawalToken(token)) return null;
  const query = db
    .select()
    .from(campaignRecipient)
    .where(eq(campaignRecipient.tokenHash, hashLinkToken(token)));
  const [row] = await (lock ? query.for("update") : query);
  return row ?? null;
}

/** The bases still given that this recipient may withdraw. */
async function withdrawable(db: AppDb, row: CampaignRecipientRow) {
  const checks = await checksFor(db, row.userId, row.bases);
  return row.bases.filter((_, at) => basisHolds(checks[at]!, row.userId));
}

export async function viewWithdrawalLink(
  ctx: UseCaseContext,
  input: { token: string }
): Promise<WithdrawalLinkView> {
  await authorize(ctx, "campaign.withdrawal_link");
  const row = await recipientByToken(ctx.db, input?.token);
  if (!row) return { ok: false, error: "not_found" };
  const open = await withdrawable(ctx.db, row);
  if (open.length === 0) return { ok: true, status: "done" };
  return {
    ok: true,
    status: "open",
    ownConsent: open.some((basis) => basis.purpose === "messages"),
    children: open.filter((basis) => basis.purpose === "communications")
      .length,
  };
}

export async function withdrawByLink(
  ctx: UseCaseContext,
  input: { token: string }
): Promise<WithdrawByLinkResult> {
  await authorize(ctx, "campaign.withdrawal_link");
  return ctx.db.transaction(async (tx): Promise<WithdrawByLinkResult> => {
    const row = await recipientByToken(tx, input?.token, true);
    if (!row) return { ok: false, error: "not_found" };
    const consentCtx = { db: tx, clock: ctx.clock, actor: ctx.actor };
    let withdrawn = 0;
    for (const basis of await withdrawable(tx, row)) {
      const changed = await withdrawByMessageLink(
        tx,
        consentCtx,
        basis.purpose === "messages"
          ? { purpose: "messages", userId: basis.subjectId }
          : {
              purpose: "communications",
              childId: basis.subjectId,
              guardianUserId: row.userId,
            }
      );
      if (changed) withdrawn += 1;
    }
    if (withdrawn === 0) return { ok: true, changed: false };
    const now = ctx.clock.now();
    await tx
      .update(campaignRecipient)
      .set({ withdrawnAt: now })
      .where(eq(campaignRecipient.id, row.id));
    await recordAudit(tx, ctx, {
      action: "campaign.withdrawal_link_used",
      entity: { type: "campaign", id: row.campaignId },
      before: null,
      after: { recipientId: row.id, withdrawn },
      actorRole: null,
    });
    return { ok: true, changed: true };
  });
}
