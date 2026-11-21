"use server";

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { safeNext } from "@/lib/second-factor-routes";
import { as, currentActor } from "@/server/app";

/** What the second-factor form shows after a try: translated text. */
export type VerifyFormView = { alert?: string; codeError?: string };

type Failure =
  | "wrong_code"
  | "code_used"
  | "not_enrolled"
  | "not_verified"
  | "challenge_expired"
  | "passkey_failed"
  | "locked";

async function alertFor(
  error: Failure,
  retryAfterSeconds = 0
): Promise<VerifyFormView> {
  const t = await getTranslations("security.form.alerts");
  return error === "locked"
    ? { alert: t("locked", { minutes: Math.ceil(retryAfterSeconds / 60) }) }
    : { alert: t(error) };
}

async function signedIn() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Where to go once the second factor passes. */
function destination(next: unknown): string {
  return safeNext(next) ?? APP_ROUTES.accountSecurity;
}

/** Checks a code from an authenticator app; on success, goes on to `next`. */
export async function verifyCodeAction(
  _previous: VerifyFormView,
  formData: FormData
): Promise<VerifyFormView> {
  const actor = await signedIn();
  const result = await as(actor).verifySecondFactor({
    code: field(formData, "code"),
  });
  if (result.ok) redirect(destination(field(formData, "next")));
  if (result.error === "invalid_input") {
    const t = await getTranslations("security.form.code");
    return { codeError: t("error") };
  }
  return alertFor(
    result.error,
    result.error === "locked" ? result.retryAfterSeconds : 0
  );
}

export type PasskeyChallenge =
  | { ok: true; options: PublicKeyCredentialRequestOptionsJSON }
  | ({ ok: false } & VerifyFormView);

/** A challenge for the browser to answer with one of the user's passkeys. */
export async function startPasskeyAction(): Promise<PasskeyChallenge> {
  const actor = await signedIn();
  const started = await as(actor).startPasskeyVerification();
  if (started.ok) return started;
  return { ok: false, ...(await alertFor(started.error)) };
}

/** Checks the browser's passkey answer; on success, goes on to `next`. */
export async function finishPasskeyAction(
  response: AuthenticationResponseJSON | null,
  next: string
): Promise<VerifyFormView> {
  const actor = await signedIn();
  if (!response) return alertFor("passkey_failed");
  const result = await as(actor).finishPasskeyVerification({ response });
  if (result.ok) redirect(destination(next));
  if (result.error === "invalid_input") return alertFor("passkey_failed");
  return alertFor(
    result.error,
    result.error === "locked" ? result.retryAfterSeconds : 0
  );
}
