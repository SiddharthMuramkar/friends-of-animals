"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createFormatter, createTranslator } from "next-intl";
import { z } from "zod";

import { formats, LOCALE, TIME_ZONE } from "@/i18n/formats";
import { messages } from "@/i18n/messages";
import { consentLinkPath } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { isWellFormedLinkToken } from "@/server/crypto/link-token";

import { ANSWER_COOKIE, answerCookieOptions } from "./cookie";

const linkToken = z.string().refine(isWellFormedLinkToken);
const formData = z.instanceof(FormData);
const t = createTranslator({
  locale: LOCALE,
  messages: { guardianConsent: messages.guardianConsent },
  namespace: "guardianConsent.errors",
});
const format = createFormatter({
  locale: LOCALE,
  timeZone: TIME_ZONE,
  formats,
});

function failure(
  error: keyof typeof messages.guardianConsent.errors,
  values?: { retryTime: string } | { attemptsLeft: number }
) {
  return { ok: false, error, message: t(error, values) } as const;
}

export async function sendCodeAction(boundToken: unknown) {
  const parsed = linkToken.safeParse(boundToken);
  if (!parsed.success) return failure("not_found");
  const token = parsed.data;
  const result = await as(await currentActor()).sendConsentLinkCode({ token });
  if (result.ok) redirect(consentLinkPath(token));
  return failure(
    result.error,
    "retryAt" in result && result.retryAt
      ? {
          retryTime: format.dateTime(result.retryAt, "longDateTime"),
        }
      : undefined
  );
}

export async function verifyCodeAction(
  boundToken: unknown,
  _previous: unknown,
  form: unknown
) {
  const parsed = linkToken.safeParse(boundToken);
  if (!parsed.success) return failure("not_found");
  const submitted = formData.safeParse(form);
  if (!submitted.success) return failure("invalid_code");
  const token = parsed.data;
  const codes = submitted.data.getAll("code");
  const [code] = codes;
  const result = await as(await currentActor()).verifyConsentLinkCode({
    token,
    code: codes.length === 1 && typeof code === "string" ? code : "",
  });
  if (!result.ok) {
    return failure(
      result.error,
      result.error === "wrong_code"
        ? { attemptsLeft: result.attemptsLeft }
        : undefined
    );
  }
  const jar = await cookies();
  jar.set(ANSWER_COOKIE, result.sessionToken, {
    ...answerCookieOptions(token),
    expires: result.answerBy,
  });
  redirect(consentLinkPath(token));
}

export async function saveAnswersAction(
  boundToken: unknown,
  _previous: unknown,
  form: unknown
) {
  const parsed = linkToken.safeParse(boundToken);
  if (!parsed.success) return failure("not_found");
  const submitted = formData.safeParse(form);
  if (!submitted.success) return failure("invalid_answer");
  const token = parsed.data;
  const answers: Record<string, unknown> = Object.create(null);
  // Keep unexpected choices and reject repeated fields at the use-case seam.
  for (const [field, answer] of submitted.data.entries()) {
    if (!field.startsWith("answer:")) continue;
    const purpose = field.slice("answer:".length);
    answers[purpose] = Object.hasOwn(answers, purpose) ? null : answer;
  }
  const jar = await cookies();
  const sessionToken = jar.get(ANSWER_COOKIE)?.value;
  const result = await as(await currentActor()).answerConsentLink({
    token,
    ...(sessionToken ? { sessionToken } : {}),
    answers,
  });
  if (!result.ok) return failure(result.error);
  jar.set(ANSWER_COOKIE, "", {
    ...answerCookieOptions(token),
    maxAge: 0,
  });
  redirect(`${consentLinkPath(token)}?done=1`);
}
