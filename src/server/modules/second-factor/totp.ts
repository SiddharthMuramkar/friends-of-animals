// Authenticator apps (TOTP) and the second factor for a session.
//
//   startTotpEnrolment({ label })             → a new secret, pending
//   confirmTotpEnrolment({ factorId, code })  → enrolled, session verified
//   verifySecondFactor({ code })              → session verified
//   mySecondFactors()                         → factors and this session
//
// Loads under plain Node: relative imports only.

import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { isStaffRole } from "../../access/domain/roles";
import { grantsOf } from "../../access/grants";
import { recordAudit } from "../../audit/record";
import { secondFactor, user, type SecondFactorKind } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { guardedAttempt, type Locked } from "./attempts";
import { base32Encode } from "./domain/base32";
import {
  generateTotpSecret,
  otpauthUri,
  TOTP,
  verifyTotp,
} from "./domain/totp";
import { openTotpSecret, sealTotpSecret } from "./secret-box";
import { DomainError } from "../../errors";
import { secondFactorRefusal } from "./requirement";
import {
  isEnrolled,
  secondFactorStatus,
  signedInUser,
  stampSession,
  type SignedInUser,
} from "./session-factor";
import { SECOND_FACTOR_SETTINGS } from "./settings";

export type SecondFactorContext = Pick<
  UseCaseContext,
  "db" | "clock" | "actor" | "auth"
>;

const label = z.string().trim().min(1).max(60);
const code = z
  .string()
  .transform((typed) => typed.replace(/\s+/g, ""))
  .pipe(z.string().regex(new RegExp(`^\\d{${TOTP.digits}}$`)));

const startInput = z.object({ label });
const confirmInput = z.object({ factorId: z.uuid(), code });
const verifyInput = z.object({ code });

/**
 * A first factor needs only a signed-in session. Once one exists, adding
 * another needs a fresh second factor: otherwise anyone who got into the
 * mailbox could sign in with an email code and add their own.
 */
export async function requireStepUpOnceEnrolled(
  ctx: SecondFactorContext,
  actor: SignedInUser
): Promise<void> {
  if (!(await isEnrolled(ctx.db, actor.userId))) return;
  const refusal = await secondFactorRefusal(ctx, actor, "step-up", []);
  if (refusal) {
    throw new DomainError(refusal, "Adding a factor needs a fresh one");
  }
}

export type StartTotpEnrolmentResult =
  | {
      ok: true;
      factorId: string;
      /** The secret in base32, for typing into an app by hand. */
      secret: string;
      /** The otpauth:// link the QR code holds. */
      uri: string;
    }
  | InvalidInput;

/**
 * Makes a new authenticator secret for the signed-in user, pending until
 * its first code confirms it. Starting again replaces a pending one.
 */
export async function startTotpEnrolment(
  ctx: SecondFactorContext,
  input: { label: string }
): Promise<StartTotpEnrolmentResult> {
  await authorize(ctx, "second-factor.enrol");
  const actor = signedInUser(ctx.actor);
  const parsed = startInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  await requireStepUpOnceEnrolled(ctx, actor);

  const now = ctx.clock.now();
  const factorId = uuidv7(now);
  const secret = generateTotpSecret();
  const account = await ctx.db.transaction(async (tx) => {
    await tx
      .delete(secondFactor)
      .where(
        and(
          eq(secondFactor.userId, actor.userId),
          eq(secondFactor.kind, "totp"),
          isNull(secondFactor.confirmedAt)
        )
      );
    await tx.insert(secondFactor).values({
      id: factorId,
      userId: actor.userId,
      kind: "totp",
      label: parsed.data.label,
      totpSecretSealed: sealTotpSecret(ctx.auth.secret, factorId, secret),
      createdAt: now,
    });
    const [row] = await tx
      .select({ email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, actor.userId));
    return row;
  });
  if (!account) throw new Error("The signed-in user has no account row");

  return {
    ok: true,
    factorId,
    secret: base32Encode(secret),
    uri: otpauthUri({
      issuer: SECOND_FACTOR_SETTINGS.issuer,
      // A phone-only account (#58) has no address; its name stands in.
      account: account.email ?? account.name,
      secret,
    }),
  };
}

export type ConfirmTotpEnrolmentResult =
  | { ok: true }
  | InvalidInput
  | { ok: false; error: "wrong_code" | "not_found" };

/**
 * Confirms a pending authenticator with its first code. It then counts as
 * a factor, and this session has passed it.
 */
export async function confirmTotpEnrolment(
  ctx: SecondFactorContext,
  input: { factorId: string; code: string }
): Promise<ConfirmTotpEnrolmentResult> {
  await authorize(ctx, "second-factor.enrol");
  const actor = signedInUser(ctx.actor);
  const parsed = confirmInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const [pending] = await tx
      .select({
        id: secondFactor.id,
        label: secondFactor.label,
        sealed: secondFactor.totpSecretSealed,
      })
      .from(secondFactor)
      .where(
        and(
          eq(secondFactor.id, parsed.data.factorId),
          eq(secondFactor.userId, actor.userId),
          eq(secondFactor.kind, "totp"),
          isNull(secondFactor.confirmedAt)
        )
      )
      .for("update");
    if (!pending?.sealed) return { ok: false, error: "not_found" } as const;

    const check = verifyTotp({
      secret: openTotpSecret(ctx.auth.secret, pending.id, pending.sealed),
      code: parsed.data.code,
      at: now,
      lastUsedStep: null,
    });
    if (!check.ok) return { ok: false, error: "wrong_code" } as const;

    await tx
      .update(secondFactor)
      .set({ confirmedAt: now, totpLastUsedStep: check.step })
      .where(eq(secondFactor.id, pending.id));
    await stampSession(tx, actor.sessionId, now, "totp");
    await recordAudit(tx, ctx, {
      action: "second_factor.enrolled",
      entity: { type: "user", id: actor.userId },
      before: null,
      after: { factorId: pending.id, kind: "totp", label: pending.label },
      actorRole: null,
    });
    return { ok: true } as const;
  });
}

export type VerifySecondFactorResult =
  | { ok: true }
  | InvalidInput
  | { ok: false; error: "wrong_code" | "code_used" | "not_enrolled" }
  | Locked;

/**
 * Checks a code from one of the user's authenticator apps and, if right,
 * records that this session passed its second factor now: enough for staff
 * screens, and for sensitive actions for the next 10 minutes.
 */
export async function verifySecondFactor(
  ctx: SecondFactorContext,
  input: { code: string }
): Promise<VerifySecondFactorResult> {
  await authorize(ctx, "second-factor.verify");
  const actor = signedInUser(ctx.actor);
  const parsed = verifyInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const factors = await tx
      .select({
        id: secondFactor.id,
        sealed: secondFactor.totpSecretSealed,
        lastUsedStep: secondFactor.totpLastUsedStep,
      })
      .from(secondFactor)
      .where(
        and(
          eq(secondFactor.userId, actor.userId),
          eq(secondFactor.kind, "totp"),
          isNotNull(secondFactor.confirmedAt)
        )
      )
      .orderBy(asc(secondFactor.id))
      .for("update");
    if (factors.length === 0) {
      return { ok: false, error: "not_enrolled" } as const;
    }

    return guardedAttempt<"wrong_code" | "code_used">(
      tx,
      { ...ctx, actor },
      "totp",
      async () => {
        let reused = false;
        for (const factor of factors) {
          if (!factor.sealed) continue;
          const check = verifyTotp({
            secret: openTotpSecret(ctx.auth.secret, factor.id, factor.sealed),
            code: parsed.data.code,
            at: now,
            lastUsedStep: factor.lastUsedStep,
          });
          if (check.ok) {
            await tx
              .update(secondFactor)
              .set({ totpLastUsedStep: check.step })
              .where(eq(secondFactor.id, factor.id));
            return { ok: true } as const;
          }
          if (check.reason === "reused") reused = true;
        }
        return {
          ok: false,
          error: reused ? "code_used" : "wrong_code",
        } as const;
      }
    );
  });
}

/** A factor as the security page lists it: never its secret or key. */
export type FactorSummary = {
  id: string;
  kind: SecondFactorKind;
  label: string;
  createdAt: Date;
};

export type MySecondFactors = {
  ok: true;
  /** Holds a staff role, so staff screens need a second factor. */
  staff: boolean;
  /** When this session last passed a second factor, or null. */
  verifiedAt: Date | null;
  /** Confirmed factors, oldest first. */
  factors: FactorSummary[];
};

/** The signed-in user's factors and where this session stands. */
export async function mySecondFactors(
  ctx: SecondFactorContext
): Promise<MySecondFactors> {
  await authorize(ctx, "second-factor.view-own");
  const actor = signedInUser(ctx.actor);
  const [grants, status, factors] = await Promise.all([
    grantsOf(ctx.db, actor.userId),
    secondFactorStatus(ctx.db, actor),
    ctx.db
      .select({
        id: secondFactor.id,
        kind: secondFactor.kind,
        label: secondFactor.label,
        createdAt: secondFactor.createdAt,
      })
      .from(secondFactor)
      .where(
        and(
          eq(secondFactor.userId, actor.userId),
          isNotNull(secondFactor.confirmedAt)
        )
      )
      .orderBy(asc(secondFactor.id)),
  ]);
  return {
    ok: true,
    staff: grants.some((grant) => isStaffRole(grant.role)),
    verifiedAt: status.verifiedAt,
    factors,
  };
}
