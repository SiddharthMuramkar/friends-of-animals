// Sign-up and sign-in by SMS one-time code, beside email.
//
//   signInMethods()                                  → is SMS on?
//   requestPhoneCode({ intent?, phone, name? })      → a code by SMS
//   verifyPhoneCode({ intent, phone, code, name? })  → signed in
//
// Both refuse while SMS is switched off (the `sms.enabled` setting, off
// until FOA's DLT registration is approved). Codes per phone and per IP
// are limited as for email, and an IP's email and phone codes count
// together. Texts to everyone together also have a ceiling per hour and
// per day (the `sms.maxPerHour` and `sms.maxPerDay` settings), which caps
// FOA's SMS bill (./rate-limit.ts).
//
// The number is read into E.164 (src/lib/phone.ts), so every usual way of
// typing it reaches one account. It is stored encrypted, and found through
// its blind index (./stored-phone.ts); codes are kept under that index too
// (./phone-code.ts). As with email, a code is texted whether or not an
// account has the number, so a request reveals nothing.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { parsePhoneNumber, type E164Phone } from "@/lib/phone";

import { authorize } from "../access/can";
import { user } from "../db/schema";
import { invalidInput, type InvalidInput } from "../input";
import type { UseCaseContext } from "../use-cases";
import { authFor } from "./auth";
import { codeSms } from "./code-sms";
import { createAccount } from "./create-account";
import { checkPhoneCode, issuePhoneCode } from "./phone-code";
import { takeCodeAllowance } from "./rate-limit";
import { headersFor } from "./request";
import { SIGN_IN_CODE } from "./settings";
import {
  codeInput as code,
  nameInput as name,
  storeCookies,
  visitorMeta,
} from "./sign-in-shared";
import { phoneHashOf, storedPhone } from "./stored-phone";

/** A number from another country: the form points those people to email. */
const UNSUPPORTED_COUNTRY = "unsupported_country";

const phone = z.string().transform((typed, ctx): E164Phone => {
  const parsed = parsePhoneNumber(typed);
  if (parsed.ok) return parsed.e164;
  ctx.issues.push({ code: "custom", input: undefined, message: parsed.reason });
  return z.NEVER;
});

// A sign-up sends its name with the number, so a missing one is caught
// before a code goes out.
const requestPhoneCodeInput = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("sign-up"), name, phone }),
  z.object({ intent: z.literal("sign-in"), phone }),
]);

const verifyPhoneCodeInput = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("sign-up"), name, phone, code }),
  z.object({ intent: z.literal("sign-in"), phone, code }),
]);

/** Without `intent`, a sign-in. */
export type RequestPhoneCodeInput =
  | { intent?: "sign-in"; phone: string }
  | { intent: "sign-up"; name: string; phone: string };
export type VerifyPhoneCodeInput = z.input<typeof verifyPhoneCodeInput>;

/** SMS is switched off (`sms.enabled`): codes come by email only. */
type SmsDisabled = { ok: false; error: "sms_disabled" };

export type RequestPhoneCodeResult =
  | { ok: true }
  | InvalidInput
  | SmsDisabled
  | { ok: false; error: "unsupported_country" }
  | { ok: false; error: "rate_limited"; retryAfterSeconds: number };

export type VerifyPhoneCodeResult =
  | { ok: true; userId: string; isNewAccount: boolean }
  | InvalidInput
  | SmsDisabled
  | {
      ok: false;
      error:
        | "code_invalid"
        | "code_expired"
        | "too_many_attempts"
        | "no_account";
    };

function fromAnotherCountry(error: z.ZodError): boolean {
  return error.issues.some(
    (issue) =>
      issue.path[0] === "phone" && issue.message === UNSUPPORTED_COUNTRY
  );
}

/** The ways in that work right now: email always, phone while SMS is on. */
export type SignInMethods = { email: true; phone: boolean };

export async function signInMethods(
  ctx: UseCaseContext
): Promise<SignInMethods> {
  await authorize(ctx, "signInMethods");
  return { email: true, phone: await ctx.settings.get("sms.enabled") };
}

const SMS_DISABLED: SmsDisabled = { ok: false, error: "sms_disabled" };

export async function requestPhoneCode(
  ctx: UseCaseContext,
  input: RequestPhoneCodeInput
): Promise<RequestPhoneCodeResult> {
  await authorize(ctx, "requestPhoneCode");
  const meta = visitorMeta(ctx);
  // Off means off: no text, no stored code, nothing counted.
  if (!(await ctx.settings.get("sms.enabled"))) return SMS_DISABLED;
  const parsed = requestPhoneCodeInput.safeParse({
    intent: "sign-in",
    ...input,
  });
  if (!parsed.success) {
    return fromAnotherCountry(parsed.error)
      ? { ok: false, error: UNSUPPORTED_COUNTRY }
      : invalidInput(parsed.error);
  }
  const { phone: to } = parsed.data;

  const [perHour, perDay] = await Promise.all([
    ctx.settings.get("sms.maxPerHour"),
    ctx.settings.get("sms.maxPerDay"),
  ]);
  const allowance = await takeCodeAllowance(ctx.db, {
    to: { channel: "phone", key: to, smsCeiling: { perHour, perDay } },
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

  // Straight through the SMS port, not the outbox (#55 ruling). A failed
  // send rejects, so the visitor is told; the stored code was never seen,
  // and expires.
  const code = await issuePhoneCode(ctx, phoneHashOf(ctx, to));
  await ctx.sms.send(codeSms(to, code, SIGN_IN_CODE.lifetimeMinutes));
  return { ok: true };
}

async function accountWithPhone(ctx: UseCaseContext, phoneHash: string) {
  const [found] = await ctx.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.phoneHash, phoneHash));
  return found;
}

export async function verifyPhoneCode(
  ctx: UseCaseContext,
  input: VerifyPhoneCodeInput
): Promise<VerifyPhoneCodeResult> {
  await authorize(ctx, "verifyPhoneCode");
  const meta = visitorMeta(ctx);
  // Switching SMS off also stops codes already texted from working.
  if (!(await ctx.settings.get("sms.enabled"))) return SMS_DISABLED;
  const parsed = verifyPhoneCodeInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { data } = parsed;
  const phoneHash = phoneHashOf(ctx, data.phone);

  let account = await accountWithPhone(ctx, phoneHash);
  let isNewAccount = false;
  if (account) {
    const check = await checkPhoneCode(ctx, phoneHash, data.code);
    if (check !== "ok") return { ok: false, error: check };
  } else if (data.intent === "sign-in") {
    // Never create an account from the sign-in page. The code is checked
    // first (a wrong guess counts), and a right one is kept for sign-up.
    const check = await checkPhoneCode(ctx, phoneHash, data.code, {
      keep: true,
    });
    return check === "ok"
      ? { ok: false, error: "no_account" }
      : { ok: false, error: check };
  } else {
    // Use the code and make the account with its welcome event in one
    // transaction: if saving either fails, the code is still there.
    const { name: accountName } = data;
    const outcome = await ctx.db.transaction(async (tx) => {
      const check = await checkPhoneCode(
        { ...ctx, db: tx },
        phoneHash,
        data.code
      );
      if (check !== "ok") return { check, created: false };
      const created = await createAccount(
        { db: tx, clock: ctx.clock },
        { name: accountName, phone: storedPhone(ctx, data.phone) }
      );
      return { check, created };
    });
    if (outcome.check !== "ok") return { ok: false, error: outcome.check };
    isNewAccount = outcome.created;
    // Made now, or by another sign-up with this phone meanwhile.
    account = await accountWithPhone(ctx, phoneHash);
    if (!account) throw new Error("A phone account vanished as it was made");
  }

  const { headers } = await authFor(ctx).api.startVerifiedSession({
    body: { userId: account.id },
    headers: headersFor(meta),
    returnHeaders: true,
  });
  await storeCookies(ctx.cookies, headers);
  return { ok: true, userId: account.id, isNewAccount };
}
