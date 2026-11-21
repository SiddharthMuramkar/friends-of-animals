// Sign-up and sign-in by email one-time code.
//
//   requestEmailCode({ intent?, email, name? })      → a code by email
//   verifyEmailCode({ intent, email, code, name?, messagesConsent? })
//                                                    → signed in
//
// Codes are only ever emailed, whatever the address, so a request never
// reveals whether an account exists; verifying needs the code, so saying
// "no account" there reveals nothing to someone without the mailbox.

import { isAPIError } from "better-auth/api";
import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { RequestMeta } from "../actor";
import type { SignUpConsentOutcome } from "../consent";
import { user } from "../db/schema";
import { invalidInput, type InvalidInput } from "../input";
import type { CookieJar } from "../ports/cookies";
import type { UseCaseContext } from "../use-cases";
import { authFor } from "./auth";
import { codeEmail } from "./code-email";
import { createAccount } from "./create-account";
import { authorize } from "./policy";
import { takeCodeAllowance } from "./rate-limit";
import { headersFor } from "./request";
import { EMAIL_CODE } from "./settings";

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const code = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${EMAIL_CODE.length}}$`));

const name = z.string().trim().min(1).max(100);

// A sign-up sends its name with the email, so a missing one is caught
// before a code goes out.
const requestEmailCodeInput = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("sign-up"), name, email }),
  z.object({ intent: z.literal("sign-in"), email }),
]);

const verifyEmailCodeInput = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("sign-up"),
    name,
    email,
    code,
    // The messages consent document the form showed, if its box was ticked.
    messagesConsent: z.uuid().optional(),
  }),
  z.object({ intent: z.literal("sign-in"), email, code }),
]);

/** Without `intent`, a sign-in. */
export type RequestEmailCodeInput =
  | { intent?: "sign-in"; email: string }
  | { intent: "sign-up"; name: string; email: string };
export type VerifyEmailCodeInput = z.input<typeof verifyEmailCodeInput>;

export type RequestEmailCodeResult =
  | { ok: true }
  | InvalidInput
  | { ok: false; error: "rate_limited"; retryAfterSeconds: number };

export type VerifyEmailCodeResult =
  | {
      ok: true;
      userId: string;
      isNewAccount: boolean;
      /** Only when a new account was created with the consent box ticked. */
      messagesConsent?: SignUpConsentOutcome;
    }
  | InvalidInput
  | {
      ok: false;
      error:
        | "code_invalid"
        | "code_expired"
        | "too_many_attempts"
        | "no_account";
    };

/** The visitor's request details; `authorize` has ruled out other actors. */
function visitorMeta(ctx: UseCaseContext): RequestMeta {
  if (ctx.actor.kind !== "visitor") throw new Error("unreachable");
  return ctx.actor.meta;
}

export async function requestEmailCode(
  ctx: UseCaseContext,
  input: RequestEmailCodeInput
): Promise<RequestEmailCodeResult> {
  authorize(ctx.actor, "requestEmailCode");
  const meta = visitorMeta(ctx);
  const parsed = requestEmailCodeInput.safeParse({
    intent: "sign-in",
    ...input,
  });
  if (!parsed.success) return invalidInput(parsed.error);

  const allowance = await takeCodeAllowance(ctx.db, {
    email: parsed.data.email,
    ip: meta.ip,
    now: ctx.clock.now(),
    secret: ctx.auth.secret,
  });
  if (!allowance.ok) {
    return {
      ok: false,
      error: "rate_limited",
      retryAfterSeconds: allowance.retryAfterSeconds,
    };
  }

  // Straight through the email port, not the outbox (#55 ruling). A failed
  // send rejects, so the visitor is told; the stored code was never seen,
  // and expires.
  const otp = await authFor(ctx).api.createVerificationOTP({
    body: { email: parsed.data.email, type: "sign-in" },
  });
  await ctx.email.send(
    codeEmail(parsed.data.email, otp, EMAIL_CODE.lifetimeMinutes)
  );
  return { ok: true };
}

const CODE_ERRORS = {
  INVALID_OTP: "code_invalid",
  OTP_EXPIRED: "code_expired",
  TOO_MANY_ATTEMPTS: "too_many_attempts",
} as const;

/** A wrong, expired or exhausted code, as a result; anything else rethrows. */
function codeError(error: unknown) {
  const reason = isAPIError(error) ? error.body?.code : undefined;
  if (reason && reason in CODE_ERRORS) {
    return {
      ok: false as const,
      error: CODE_ERRORS[reason as keyof typeof CODE_ERRORS],
    };
  }
  throw error;
}

async function storeCookies(jar: CookieJar, headers: Headers) {
  const setCookie = headers.get("set-cookie");
  if (!setCookie) return;
  for (const [name, attributes] of parseSetCookieHeader(setCookie)) {
    await jar.set(name, attributes.value, toCookieOptions(attributes));
  }
}

export async function verifyEmailCode(
  ctx: UseCaseContext,
  input: VerifyEmailCodeInput
): Promise<VerifyEmailCodeResult> {
  authorize(ctx.actor, "verifyEmailCode");
  const meta = visitorMeta(ctx);
  const parsed = verifyEmailCodeInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { data } = parsed;
  const auth = authFor(ctx);

  const [existing] = await ctx.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, data.email));

  let isNewAccount = false;
  let messagesConsent: SignUpConsentOutcome | undefined;
  if (!existing) {
    // Better Auth checks the code first (a wrong guess counts) and only
    // then reports that no user has the address, leaving a right code
    // unused, so it still signs in below.
    try {
      await auth.api.checkVerificationOTP({
        body: { email: data.email, type: "sign-in", otp: data.code },
      });
      // The account appeared meanwhile: sign in to it.
    } catch (error) {
      if (!isAPIError(error) || error.body?.code !== "USER_NOT_FOUND") {
        return codeError(error);
      }
      // Never create an account from the sign-in page.
      if (data.intent === "sign-in") return { ok: false, error: "no_account" };
      // The account and its welcome event, in one transaction.
      const account = await createAccount(ctx, {
        email: data.email,
        name: data.name,
        messagesConsent: data.messagesConsent,
      });
      isNewAccount = account.created;
      if (account.created) messagesConsent = account.messagesConsent;
    }
  }

  try {
    const { headers, response } = await auth.api.signInEmailOTP({
      body: { email: data.email, otp: data.code },
      headers: headersFor(meta),
      returnHeaders: true,
    });
    await storeCookies(ctx.cookies, headers);
    return {
      ok: true,
      userId: response.user.id,
      isNewAccount,
      ...(messagesConsent ? { messagesConsent } : {}),
    };
  } catch (error) {
    return codeError(error);
  }
}
