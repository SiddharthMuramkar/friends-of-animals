// Sign-up and sign-in by SMS one-time code, beside email.
//
//   signInMethods()                                  → is SMS on?
//   requestPhoneCode({ intent?, phone, name? })      → a code by SMS
//   verifyPhoneCode({ intent, phone, code, name? })  → signed in
//
// Both refuse while SMS is switched off (the `sms.enabled` setting, off
// until FOA's DLT registration is approved). Codes per phone and per IP
// are limited as for email, and an IP's email and phone codes count
// together (./rate-limit.ts).
//
// The number is read into E.164 (src/lib/phone.ts), so every usual way of
// typing it reaches one account. It is stored encrypted, and found through
// its blind index (./stored-phone.ts); codes are kept under that index too
// (./phone-code.ts). As with email, a code is texted whether or not an
// account has the number, so a request reveals nothing.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { parsePhoneNumber, type E164Phone } from "@/lib/phone";

import { user } from "../db/schema";
import { uuidv7 } from "../ids";
import type { UseCaseContext } from "../use-cases";
import { authFor } from "./auth";
import { codeSms } from "./code-sms";
import { checkPhoneCode, issuePhoneCode } from "./phone-code";
import { authorize } from "../access/can";
import { takeCodeAllowance } from "./rate-limit";
import { headersFor } from "./request";
import { EMAIL_CODE } from "./settings";
import {
  codeInput as code,
  invalidInput,
  nameInput as name,
  storeCookies,
  visitorMeta,
  type InvalidInput,
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

  const allowance = await takeCodeAllowance(ctx.db, {
    to: { channel: "phone", key: to },
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
  await ctx.sms.send(codeSms(to, code, EMAIL_CODE.lifetimeMinutes));
  return { ok: true };
}

async function accountWithPhone(ctx: UseCaseContext, phoneHash: string) {
  const [found] = await ctx.db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.phoneHash, phoneHash));
  return found;
}

/** A new account holding only this verified phone, or the one that has it. */
async function createPhoneAccount(
  ctx: UseCaseContext,
  to: E164Phone,
  accountName: string
): Promise<{ id: string; created: boolean }> {
  const now = ctx.clock.now();
  const [created] = await ctx.db
    .insert(user)
    .values({
      id: uuidv7(now),
      name: accountName,
      email: null,
      ...storedPhone(ctx, to),
      phoneVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    // Another sign-up with this phone got there first: sign in to it.
    .onConflictDoNothing({ target: user.phoneHash })
    .returning({ id: user.id });
  if (created) return { id: created.id, created: true };
  const existing = await accountWithPhone(ctx, phoneHashOf(ctx, to));
  if (!existing) throw new Error("A phone account vanished as it was made");
  return { id: existing.id, created: false };
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
  if (data.intent === "sign-in" && !account) {
    // Never create an account from the sign-in page. The code is checked
    // first (a wrong guess counts), and a right one is kept for sign-up.
    const check = await checkPhoneCode(ctx, phoneHash, data.code, {
      keep: true,
    });
    return check === "ok"
      ? { ok: false, error: "no_account" }
      : { ok: false, error: check };
  }

  const check = await checkPhoneCode(ctx, phoneHash, data.code);
  if (check !== "ok") return { ok: false, error: check };

  let isNewAccount = false;
  if (!account) {
    const made = await createPhoneAccount(
      ctx,
      data.phone,
      data.intent === "sign-up" ? data.name : ""
    );
    account = { id: made.id };
    isNewAccount = made.created;
  }

  const { headers } = await authFor(ctx).api.startVerifiedSession({
    body: { userId: account.id },
    headers: headersFor(meta),
    returnHeaders: true,
  });
  await storeCookies(ctx.cookies, headers);
  return { ok: true, userId: account.id, isNewAccount };
}
