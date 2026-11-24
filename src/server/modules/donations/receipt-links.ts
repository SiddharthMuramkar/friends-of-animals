// Receipts behind links (#106). A receipt is only ever opened through a
// 7-day link (#55): the token's SHA-256 finds it, and nothing extends an
// old link; a new one is a new token.
//
//   getReceiptByToken          anyone holding the link: the frozen receipt,
//                              or `expired`, or `not_found` (a malformed
//                              token is never looked up).
//   reissueReceiptLink         the donor's own account (emailed, never
//                              shown), or finance (shown on screen, never
//                              mailed). Nobody else.
//   requestReceiptLinkByEmail  a guest with their email and receipt
//                              number: a match emails the donor's address;
//                              a mismatch sends nothing. Both answer the
//                              same, and both count against the limits.

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { donation, donor, receipt, receiptLink } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import { emit } from "../../outbox/emit";
import type { UseCaseContext } from "../../use-cases";
import { ipNetwork } from "../../../lib/ip-network";
import { receiptPath } from "../../../lib/app-routes";
import {
  formKeyedHash,
  publicSender,
  takeFormAllowance,
} from "../public-forms";
import {
  hashReceiptLinkToken,
  mintReceiptLinkToken,
  receiptLinkExpiresAt,
  receiptLinkState,
} from "./domain/receipt-link";
import { parseReceiptNumber } from "./domain/receipt-number";
import { donorEmailHash } from "./donors";
import type { ReceiptSnapshot } from "./receipts/snapshot";

export type GetReceiptByTokenInput = { token: string };

export type ReceiptView = {
  snapshot: ReceiptSnapshot;
  /** Set once the donation was refunded in full: the receipt is void. */
  cancelledAt: Date | null;
  /** When this link stops opening it. */
  linkExpiresAt: Date;
};

export type GetReceiptByTokenResult =
  | { ok: true; receipt: ReceiptView }
  | { ok: false; error: "not_found" | "expired" };

export async function getReceiptByToken(
  ctx: UseCaseContext,
  input: GetReceiptByTokenInput
): Promise<GetReceiptByTokenResult> {
  await authorize(ctx, "donation.receipt.read");
  const tokenHash =
    typeof input?.token === "string" ? hashReceiptLinkToken(input.token) : null;
  if (!tokenHash) return { ok: false, error: "not_found" };
  const [found] = await ctx.db
    .select({
      snapshot: receipt.snapshot,
      cancelledAt: receipt.cancelledAt,
      expiresAt: receiptLink.expiresAt,
    })
    .from(receiptLink)
    .innerJoin(receipt, eq(receipt.id, receiptLink.receiptId))
    .where(eq(receiptLink.tokenHash, tokenHash));
  if (!found) return { ok: false, error: "not_found" };
  if (receiptLinkState(found, ctx.clock.now()) === "expired") {
    return { ok: false, error: "expired" };
  }
  return {
    ok: true,
    receipt: {
      snapshot: found.snapshot,
      cancelledAt: found.cancelledAt,
      linkExpiresAt: found.expiresAt,
    },
  };
}

export type ReissueReceiptLinkInput = { donationId: string };

export type ReissueReceiptLinkResult =
  /** The donor's link went to their email. */
  | { ok: true; issuedTo: "donor" }
  /** Finance's link, to open or pass on by hand; it is never mailed. */
  | { ok: true; issuedTo: "finance"; path: string; expiresAt: Date }
  | InvalidInput
  | { ok: false; error: "not_found" | "receipt_cancelled" };

const reissueInput = z.strictObject({ donationId: z.uuid() });

export async function reissueReceiptLink(
  ctx: UseCaseContext,
  input: ReissueReceiptLinkInput
): Promise<ReissueReceiptLinkResult> {
  const parsed = reissueInput.safeParse(input);
  if (!parsed.success) {
    await authorize(ctx, "donation.receipt.reissue");
    return invalidInput(parsed.error);
  }
  const [found] = await ctx.db
    .select({
      ownerId: donor.userId,
      receiptId: receipt.id,
      cancelledAt: receipt.cancelledAt,
    })
    .from(donation)
    .innerJoin(donor, eq(donor.id, donation.donorId))
    .leftJoin(receipt, eq(receipt.donationId, donation.id))
    .where(eq(donation.id, parsed.data.donationId));
  const { role } = await authorize(
    ctx,
    "donation.receipt.reissue",
    found?.ownerId ? { ownerId: found.ownerId } : {}
  );
  if (!found?.receiptId) return { ok: false, error: "not_found" };
  if (found.cancelledAt) return { ok: false, error: "receipt_cancelled" };
  const receiptId = found.receiptId;
  const now = ctx.clock.now();
  const userId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
  const toFinance = role === "finance";

  return ctx.db.transaction(async (tx): Promise<ReissueReceiptLinkResult> => {
    let made: { path: string; expiresAt: Date } | null = null;
    if (toFinance) {
      const { token, tokenHash } = mintReceiptLinkToken();
      const expiresAt = receiptLinkExpiresAt(now);
      await tx.insert(receiptLink).values({
        id: uuidv7(now),
        receiptId,
        tokenHash,
        issuedTo: "finance",
        createdByUserId: userId,
        createdAt: now,
        expiresAt,
      });
      made = { path: receiptPath(token), expiresAt };
    } else {
      await emit(tx, ctx.clock, {
        type: "receipt.link_requested",
        aggregate: { type: "receipt", id: receiptId },
        payload: { receiptId },
      });
    }
    await recordAudit(tx, ctx, {
      action: "receipt.link_reissued",
      entity: { type: "receipt", id: receiptId },
      before: null,
      after: { issuedTo: toFinance ? "finance" : "donor" },
      actorRole: role,
    });
    return made
      ? { ok: true, issuedTo: "finance", ...made }
      : { ok: true, issuedTo: "donor" };
  });
}

export type RequestReceiptLinkByEmailInput = {
  email: string;
  receiptNumber: string;
};

export type RequestReceiptLinkByEmailResult =
  /** The same answer whether or not anything was sent. */
  | { ok: true }
  | InvalidInput
  | {
      ok: false;
      error: "rate_limited";
      retryAfter: Date;
      retryAfterSeconds: number;
    };

/** Asks per address and per network, per hour (HR-51 confirms them). */
export const RECEIPT_REQUEST_LIMITS = {
  perEmailPerHour: 5,
  perNetworkPerHour: 20,
} as const;

const HOUR_MS = 60 * 60 * 1000;

const requestInput = z.strictObject({
  email: z.string().trim().pipe(z.email().max(254)),
  receiptNumber: z.string().trim().min(1).max(40),
});

export async function requestReceiptLinkByEmail(
  ctx: UseCaseContext,
  input: RequestReceiptLinkByEmailInput
): Promise<RequestReceiptLinkByEmailResult> {
  const sender = await publicSender(ctx, "donation.receipt.request");
  const parsed = requestInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const email = parsed.data.email.trim().toLowerCase();
  const now = ctx.clock.now();

  return ctx.db.transaction(
    async (tx): Promise<RequestReceiptLinkByEmailResult> => {
      const allowance = await takeFormAllowance(tx, {
        form: "receipt_link",
        rules: [
          {
            scope: "email",
            key: email,
            max: RECEIPT_REQUEST_LIMITS.perEmailPerHour,
            windowMs: HOUR_MS,
          },
          {
            scope: "ip",
            key: ipNetwork(sender.ip),
            max: RECEIPT_REQUEST_LIMITS.perNetworkPerHour,
            windowMs: HOUR_MS,
          },
        ],
        now,
        hash: formKeyedHash(ctx),
      });
      if (!allowance.ok) {
        return {
          ok: false,
          error: "rate_limited",
          retryAfter: allowance.retryAfter,
          retryAfterSeconds: allowance.retryAfterSeconds,
        };
      }
      const number = parseReceiptNumber(parsed.data.receiptNumber);
      if (!number) return { ok: true };
      const [match] = await tx
        .select({ receiptId: receipt.id })
        .from(receipt)
        .innerJoin(donation, eq(donation.id, receipt.donationId))
        .innerJoin(donor, eq(donor.id, donation.donorId))
        .where(
          and(
            eq(receipt.fy, number.fy),
            eq(receipt.seq, number.seq),
            eq(donor.emailHash, donorEmailHash(ctx.blindIndex, email)),
            isNull(receipt.cancelledAt)
          )
        );
      if (!match) return { ok: true };
      await emit(tx, ctx.clock, {
        type: "receipt.link_requested",
        aggregate: { type: "receipt", id: match.receiptId },
        payload: { receiptId: match.receiptId },
      });
      await recordAudit(tx, ctx, {
        action: "receipt.link_requested",
        entity: { type: "receipt", id: match.receiptId },
        before: null,
        after: { issuedTo: "donor" },
        actorRole: null,
      });
      return { ok: true };
    }
  );
}
