// The guardian's one-time code (#81):
//
//   startGuardianVerification()            → a fresh code to the member's
//                                            own verified email, sent
//                                            straight through the email
//                                            port, not the outbox (#55
//                                            ruling for codes)
//   confirmGuardianVerification({ code })  → verified now, by email code,
//                                            with the global guardian role
//
// Code requests count against the sign-in limits for that address
// (src/server/identity/rate-limit.ts), and a code survives five wrong
// guesses, as sign-in codes do. The verification is separate from signing
// in, so the record shows the moment the declaration was confirmed.

import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { z } from "zod";

import guardianMessages from "../../../../messages/en-IN/guardian.json";
import { authorize } from "../../access/can";
import { sortGrants, type Grant } from "../../access/domain/roles";
import { grantsOf } from "../../access/grants";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { guardian, user, userRole } from "../../db/schema";
import { takeCodeAllowance } from "../../identity/rate-limit";
import { SIGN_IN_CODE } from "../../identity/settings";
import { uuidv7 } from "../../ids";
import type { EmailMessage } from "../../ports/email";
import type { UseCaseContext } from "../../use-cases";
import { maskIdentifier } from "../institutions/domain/mask-identifier";
import { verifiedEmailOf } from "./account-contact";
import { guardianOfUser } from "./guardian-record";
import { checkGuardianCode, issueGuardianCode } from "./verification-code";

type NotReady = { ok: false; error: "not_registered" | "already_verified" };

export type StartGuardianVerificationResult =
  | { ok: true; sentTo: string; expiresAt: Date }
  | NotReady
  | { ok: false; error: "no_verified_email" }
  | { ok: false; error: "rate_limited"; retryAfterSeconds: number };

export type ConfirmGuardianVerificationResult =
  | { ok: true }
  | NotReady
  | {
      ok: false;
      error: "code_invalid" | "code_expired" | "too_many_attempts";
    };

const confirmInput = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

const t = createTranslator({
  locale: "en-IN",
  messages: guardianMessages,
  namespace: "guardian.codeEmail",
});

function codeEmail(to: string, code: string): EmailMessage {
  return {
    to,
    subject: t("subject"),
    text: t("text", { code, minutes: SIGN_IN_CODE.lifetimeMinutes }),
  };
}

function signedInUser(ctx: UseCaseContext) {
  if (ctx.actor.kind !== "user") {
    // authorize() has already refused anyone else.
    throw new Error("Guardian verification needs a signed-in user");
  }
  return ctx.actor;
}

export async function startGuardianVerification(
  ctx: UseCaseContext
): Promise<StartGuardianVerificationResult> {
  await authorize(ctx, "guardian.register");
  const actor = signedInUser(ctx);
  const record = await guardianOfUser(ctx.db, actor.userId);
  if (!record) return { ok: false, error: "not_registered" };
  if (record.verifiedAt) return { ok: false, error: "already_verified" };
  // Phone codes for guardians wait for their own DLT template (HR-14).
  const email = await verifiedEmailOf(ctx.db, actor.userId);
  if (email === null) return { ok: false, error: "no_verified_email" };

  const allowance = await takeCodeAllowance(ctx.db, {
    to: { channel: "email", key: email },
    ip: actor.meta.ip,
    now: ctx.clock.now(),
    secret: ctx.auth.secret,
    limits: ctx.codeRequestLimits,
  });
  if (!allowance.ok) {
    return {
      ok: false,
      error: "rate_limited",
      retryAfterSeconds: allowance.retryAfterSeconds,
    };
  }
  const { code, expiresAt } = await issueGuardianCode(ctx, record.id);
  // A failed send rejects, so the guardian is told; the stored code was
  // never seen, and expires.
  await ctx.email.send(codeEmail(email, code));
  return { ok: true, sentTo: maskIdentifier("email", email), expiresAt };
}

export async function confirmGuardianVerification(
  ctx: UseCaseContext,
  input: { code: string }
): Promise<ConfirmGuardianVerificationResult> {
  const { role: actorRole } = await authorize(ctx, "guardian.register");
  const { userId } = signedInUser(ctx);
  const parsed = confirmInput.safeParse(input);
  const now = ctx.clock.now();

  return ctx.db.transaction(
    async (tx): Promise<ConfirmGuardianVerificationResult> => {
      await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .for("no key update");
      const record = await guardianOfUser(tx, userId);
      if (!record) return { ok: false, error: "not_registered" };
      if (record.verifiedAt) return { ok: false, error: "already_verified" };
      // Anything that isn't six digits is a wrong guess like any other.
      const check = await checkGuardianCode(
        { ...ctx, db: tx },
        record.id,
        parsed.success ? parsed.data.code : "not-a-code"
      );
      if (check !== "ok") return { ok: false, error: check };

      await tx
        .update(guardian)
        .set({
          verifiedAt: now,
          verificationMethod: "email_otp",
          updatedAt: now,
        })
        .where(eq(guardian.id, record.id));
      await recordAudit(tx, ctx, {
        action: "guardian.verified",
        entity: { type: "guardian", id: record.id },
        before: { verifiedAt: null },
        after: { verifiedAt: now, verificationMethod: "email_otp" },
        actorRole,
      });
      await grantGlobalRole(tx, ctx, userId, "guardian");
      return { ok: true };
    }
  );
}

/**
 * Grants `role` everywhere to `userId`, with its audit entry; holding it
 * already changes nothing. Granted by the flow itself, so no user is named
 * as granting it.
 */
export async function grantGlobalRole(
  tx: AppDb,
  ctx: Pick<UseCaseContext, "clock" | "actor">,
  userId: string,
  role: "guardian" | "participant"
): Promise<void> {
  const now = ctx.clock.now();
  const grant: Grant = { role, scope: { type: "global" } };
  const before = await grantsOf(tx, userId);
  const [inserted] = await tx
    .insert(userRole)
    .values({
      id: uuidv7(now),
      userId,
      role,
      scopeType: "global",
      scopeId: null,
      grantedByUserId: null,
      grantedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: userRole.id });
  if (!inserted) return;
  await recordAudit(tx, ctx, {
    action: "role.granted",
    entity: { type: "user", id: userId },
    before,
    after: sortGrants([...before, grant]),
    actorRole: null,
  });
}
