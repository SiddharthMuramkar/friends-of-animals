import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";

import { LOCALE } from "@/i18n/formats";

import deliveryWords from "../../../../messages/en-IN/guardianConsentDelivery.json";
import { authorize } from "../../access/can";
import {
  createLinkToken,
  hashLinkToken,
  isWellFormedLinkToken,
} from "../../crypto/link-token";
import { consentLink } from "../../db/schema";
import { takeConsentLinkCodeAllowance } from "../../identity/rate-limit";
import type { UseCaseContext } from "../../use-cases";
import { nameParts } from "../consent/domain/public-credit";
import { maskIdentifier } from "../institutions/domain/mask-identifier";
import { sendToLinkContact } from "./delivery";
import {
  answerDeadline,
  CODE_TTL_MS,
  closedReason,
  decideSendCode,
  decideVerifyCode,
  linkStatus,
} from "./domain/link";
import {
  createOneTimeCode,
  hashOneTimeCode,
  oneTimeCodeMatches,
} from "./domain/one-time-code";
import type { OfferedPublicUse } from "./offered-uses";
import {
  activeLinkTarget,
  consentLinksActive,
  findLink,
  LINK_CONTACT,
} from "./repository";

export type LinkInput = { token: string };
export type ViewConsentLinkInput = LinkInput & { sessionToken?: string };
export type VerifyConsentLinkCodeInput = LinkInput & { code: string };

const codeWords = createTranslator({
  locale: LOCALE,
  messages: deliveryWords,
  namespace: "guardianConsentDelivery.code",
});

export function tokenHash(ctx: UseCaseContext, token: unknown): string | null {
  return consentLinksActive(ctx.appEnv) &&
    typeof token === "string" &&
    isWellFormedLinkToken(token)
    ? hashLinkToken(token)
    : null;
}

export function sessionMatches(
  sessionToken: unknown,
  stored: string | null
): boolean {
  if (
    typeof sessionToken !== "string" ||
    !isWellFormedLinkToken(sessionToken) ||
    !stored
  )
    return false;
  const actual = Buffer.from(hashLinkToken(sessionToken), "hex");
  const expected = Buffer.from(stored, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type ConsentLinkView =
  | { status: "not_found" | "used" | "revoked" | "expired" }
  | ((
      | { status: "sent" | "opened" }
      | { status: "verified"; answerBy: Date }
    ) & {
      childFirstName: string;
      competitionTitle: string;
      institutionName: string;
      maskedContact: string;
      uses: OfferedPublicUse[];
    });

export async function viewConsentLink(
  ctx: UseCaseContext,
  input: ViewConsentLinkInput
): Promise<ConsentLinkView> {
  await authorize(ctx, "consent_link.view");
  const hash = tokenHash(ctx, input?.token);
  const link = hash && (await findLink(ctx.db, hash));
  if (!link) return { status: "not_found" } as const;
  const now = ctx.clock.now();
  const closed = closedReason(link, now);
  if (closed)
    return { status: closed === "already_used" ? "used" : closed } as const;
  const target = await activeLinkTarget(ctx.db, link);
  if (!target) return { status: "not_found" } as const;
  const state = linkStatus(link, now);
  const verifiedAt =
    state === "verified" &&
    sessionMatches(input.sessionToken, link.sessionTokenHash)
      ? link.verifiedAt
      : null;
  return {
    ...(verifiedAt
      ? {
          status: "verified",
          answerBy: answerDeadline(verifiedAt, link.expiresAt),
        }
      : { status: state === "sent" ? "sent" : "opened" }),
    childFirstName: nameParts(target.student.name).firstName,
    competitionTitle: target.school.competition.name,
    institutionName: target.school.institutionName,
    maskedContact: maskIdentifier(
      link.channel === "email" ? "email" : "phone",
      ctx.cipher.decrypt(LINK_CONTACT, link.contactCiphertext)
    ),
    uses: link.offeredUses,
  } as const;
}

export async function sendConsentLinkCode(
  ctx: UseCaseContext,
  input: LinkInput
) {
  await authorize(ctx, "consent_link.code");
  const hash = tokenHash(ctx, input?.token);
  if (!hash || ctx.actor.kind === "system")
    return { ok: false, error: "not_found" } as const;
  const { ip } = ctx.actor.meta;
  const smsEnabled = await ctx.settings.get("sms.enabled");

  const reserved = await ctx.db.transaction(async (tx) => {
    const link = await findLink(tx, hash, true);
    if (!link) return { ok: false, error: "not_found" } as const;
    const now = ctx.clock.now();
    const closed = closedReason(link, now);
    if (closed) return { ok: false, error: closed } as const;
    if (!(await activeLinkTarget(tx, link)))
      return { ok: false, error: "not_found" } as const;
    const decision = decideSendCode(link, now);
    if (!decision.ok) {
      return decision.reason === "wait"
        ? ({
            ok: false,
            error: decision.reason,
            retryAt: decision.retryAt,
          } as const)
        : ({ ok: false, error: decision.reason } as const);
    }
    if (link.channel === "sms" && !smsEnabled) {
      return { ok: false, error: "sms_disabled" } as const;
    }
    const allowance = await takeConsentLinkCodeAllowance(tx, {
      contactHash: link.contactHash,
      ip,
      now,
      secret: ctx.auth.secret,
    });
    if (!allowance.ok) {
      return {
        ok: false,
        error: "rate_limited",
        retryAt: new Date(now.getTime() + allowance.retryAfterSeconds * 1000),
      } as const;
    }

    const code = createOneTimeCode();
    await tx
      .update(consentLink)
      .set({
        ...decision.patch,
        codeHash: hashOneTimeCode(ctx.auth.secret, link.id, code),
        sessionTokenHash: null,
        updatedAt: now,
      })
      .where(eq(consentLink.id, link.id));
    return { ok: true, link, code } as const;
  });

  if (!reserved.ok) return reserved;
  const { link, code } = reserved;
  try {
    // The reserved code remains subject to its limit and cooldown even if
    // the provider times out after accepting the message.
    await sendToLinkContact(ctx, link, {
      subject: codeWords("subject"),
      text: codeWords("text", { code, minutes: CODE_TTL_MS / 60_000 }),
      vars: { code },
    });
  } catch {
    return { ok: false, error: "delivery_failed" } as const;
  }
  return { ok: true } as const;
}

export async function verifyConsentLinkCode(
  ctx: UseCaseContext,
  input: VerifyConsentLinkCodeInput
) {
  await authorize(ctx, "consent_link.verify");
  const hash = tokenHash(ctx, input?.token);
  if (!hash) return { ok: false, error: "not_found" } as const;

  return ctx.db.transaction(async (tx) => {
    const link = await findLink(tx, hash, true);
    if (!link) return { ok: false, error: "not_found" } as const;
    const now = ctx.clock.now();
    const closed = closedReason(link, now);
    if (closed) return { ok: false, error: closed } as const;
    if (!(await activeLinkTarget(tx, link)))
      return { ok: false, error: "not_found" } as const;

    const matches =
      typeof input.code === "string" &&
      input.code.length <= 64 &&
      oneTimeCodeMatches(ctx.auth.secret, link.id, input.code, link.codeHash);
    const decision = decideVerifyCode(link, now, matches);
    if (!decision.ok) {
      if (decision.reason !== "wrong_code")
        return { ok: false, error: decision.reason } as const;
      await tx
        .update(consentLink)
        .set({ ...decision.patch, updatedAt: now })
        .where(eq(consentLink.id, link.id));
      return {
        ok: false,
        error: decision.reason,
        attemptsLeft: decision.attemptsLeft,
      } as const;
    }
    const session = createLinkToken();
    await tx
      .update(consentLink)
      .set({
        ...decision.patch,
        codeHash: null,
        sessionTokenHash: session.tokenHash,
        updatedAt: now,
      })
      .where(eq(consentLink.id, link.id));
    return {
      ok: true,
      sessionToken: session.token,
      answerBy: decision.answerBy,
    } as const;
  });
}
