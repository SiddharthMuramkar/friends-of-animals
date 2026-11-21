"use server";

import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getTranslations } from "next-intl/server";
import { redirect, RedirectType } from "next/navigation";

import { orSecondFactor } from "@/app/auth/_lib/refusal";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { safeNext } from "@/lib/second-factor-routes";
import { as, currentActor } from "@/server/app";

import { groupKey, qrCode } from "./totp-setup";

const SECURITY = APP_ROUTES.accountSecurity;

async function signedIn() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Back to the page the user was sent here from, now that a new factor has
 * verified this session; else the security page, saying it worked.
 */
function afterAdding(next: string): never {
  const back = safeNext(next);
  redirect(
    back ?? `${SECURITY}?added=${Date.now().toString(36)}`,
    RedirectType.replace
  );
}

export type TotpEnrolView =
  | { step: "label"; label?: string; labelError?: string; alert?: string }
  | {
      step: "code";
      factorId: string;
      label: string;
      /** The setup key in groups of four. */
      key: string;
      qr: { size: number; path: string };
      codeError?: string;
    };

/**
 * Adding an authenticator app, in two steps on one form: name it (which
 * makes the secret and shows its QR code), then type its first code.
 */
export async function totpEnrolAction(
  previous: TotpEnrolView,
  formData: FormData
): Promise<TotpEnrolView> {
  const actor = await signedIn();
  const t = await getTranslations("security.totp");
  const step = field(formData, "step");
  const next = field(formData, "next");
  const back = safeNext(next) ?? SECURITY;

  if (step === "restart") return { step: "label" };

  if (step === "confirm" && previous.step === "code") {
    const result = await orSecondFactor(
      () =>
        as(actor).confirmTotpEnrolment({
          factorId: previous.factorId,
          code: field(formData, "code"),
        }),
      back
    );
    if (result.ok) afterAdding(next);
    if (result.error === "not_found") {
      return { step: "label", alert: t("expired") };
    }
    return {
      ...previous,
      codeError:
        result.error === "wrong_code" ? t("wrongCode") : t("code.error"),
    };
  }

  const label = field(formData, "label");
  const started = await orSecondFactor(
    () => as(actor).startTotpEnrolment({ label }),
    back
  );
  if (!started.ok) {
    return { step: "label", label, labelError: t("label.error") };
  }
  return {
    step: "code",
    factorId: started.factorId,
    label,
    key: groupKey(started.secret),
    qr: qrCode(started.uri),
  };
}

/** Removes one of the user's factors, after step-up if it's stale. */
export async function removeFactorAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const result = await orSecondFactor(
    () =>
      as(actor).removeSecondFactor({ factorId: field(formData, "factorId") }),
    SECURITY
  );
  const notice = result.ok ? "removed" : "notFound";
  redirect(
    `${SECURITY}?${notice}=${Date.now().toString(36)}`,
    RedirectType.replace
  );
}

/** A challenge for the browser to make a passkey with. */
export async function startPasskeyRegistrationAction(
  next: string
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const actor = await signedIn();
  const started = await orSecondFactor(
    () => as(actor).startPasskeyRegistration(),
    safeNext(next) ?? SECURITY
  );
  return started.options;
}

export type PasskeyEnrolView = { alert?: string; labelError?: string };

/** Keeps the browser's new passkey, then goes on. */
export async function finishPasskeyRegistrationAction(input: {
  label: string;
  response: RegistrationResponseJSON | null;
  next: string;
}): Promise<PasskeyEnrolView> {
  const actor = await signedIn();
  const t = await getTranslations("security.passkey");
  if (!input.response) return { alert: t("failed") };
  const result = await orSecondFactor(
    () =>
      as(actor).finishPasskeyRegistration({
        label: input.label,
        response: input.response!,
      }),
    safeNext(input.next) ?? SECURITY
  );
  if (result.ok) afterAdding(input.next);
  switch (result.error) {
    case "invalid_input":
      return { labelError: t("label.error") };
    case "not_verified":
      return { alert: t("notVerified") };
    case "already_registered":
      return { alert: t("alreadyRegistered") };
    case "challenge_expired":
      return { alert: t("failed") };
  }
}
