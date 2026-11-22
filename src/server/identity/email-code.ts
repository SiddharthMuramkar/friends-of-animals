// Sign-up and sign-in by email one-time code.
//
//   requestEmailCode({ intent?, email, name? })      → a code by email
//   verifyEmailCode({ intent, email, code, name?, messagesConsent? })
//                                                    → signed in
//
// Codes are only ever emailed, whatever the address, so a request never
// reveals whether an account exists; verifying needs the code, so saying
// "no account" there reveals nothing to someone without the mailbox.
//
// Both refuse while email sign-in is off (the `auth.emailSignIn` setting;
// production also keeps it off until SES can send to anyone, DECISIONS
// R-27), and the pages say sign-in opens soon.

import { isAPIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../access/can";
import { user } from "../db/schema";
import { invalidInput, type InvalidInput } from "../input";
import type { SignUpConsentOutcome } from "../modules/consent";
import type { UseCaseContext } from "../use-cases";
import { authFor } from "./auth";
import { codeEmail } from "./code-email";
import { createAccount } from "./create-account";
import { takeCodeAllowance } from "./rate-limit";
import { headersFor } from "./request";
import { SIGN_IN_CODE } from "./settings";
import {
  codeInput as code,
  nameInput as name,
  storeCookies,
  visitorMeta,
} from "./sign-in-shared";

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

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

/** Email sign-in is off (`auth.emailSignIn`): sign-in opens soon. */
type EmailDisabled = { ok: false; error: "email_disabled" };

const EMAIL_DISABLED: EmailDisabled = { ok: false, error: "email_disabled" };

export type RequestEmailCodeResult =
  | { ok: true }
  | InvalidInput
  | EmailDisabled
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
  | EmailDisabled
  | {
      ok: false;
      error:
        | "code_invalid"
        | "code_expired"
        | "too_many_attempts"
        | "no_account";
    };

export async function requestEmailCode(
  ctx: UseCaseContext,
  input: RequestEmailCodeInput
): Promise<RequestEmailCodeResult> {
  await authorize(ctx, "requestEmailCode");
  const meta = visitorMeta(ctx);
  // Off means off: no email, no stored code, nothing counted.
  if (!(await ctx.settings.get("auth.emailSignIn"))) return EMAIL_DISABLED;
  const parsed = requestEmailCodeInput.safeParse({
    intent: "sign-in",
    ...input,
  });
  if (!parsed.success) return invalidInput(parsed.error);

  const allowance = await takeCodeAllowance(ctx.db, {
    to: { channel: "email", key: parsed.data.email },
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
    codeEmail(parsed.data.email, otp, SIGN_IN_CODE.lifetimeMinutes)
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

export async function verifyEmailCode(
  ctx: UseCaseContext,
  input: VerifyEmailCodeInput
): Promise<VerifyEmailCodeResult> {
  await authorize(ctx, "verifyEmailCode");
  const meta = visitorMeta(ctx);
  // Switching email sign-in off also stops codes already emailed working.
  if (!(await ctx.settings.get("auth.emailSignIn"))) return EMAIL_DISABLED;
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
