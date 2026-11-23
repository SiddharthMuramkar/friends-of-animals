"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { consentLinkPath } from "@/lib/app-routes";
import { appEnv } from "@/lib/site";
import { as, currentActor } from "@/server/app";
import { ANSWER_WINDOW_MS } from "@/server/modules/consent-links/domain/link";

import { ANSWER_COOKIE } from "./cookie";

export async function sendCodeAction(token: string) {
  const result = await as(await currentActor()).sendConsentLinkCode({ token });
  if (result.ok) redirect(consentLinkPath(token));
  return result;
}

export async function verifyCodeAction(
  token: string,
  _previous: unknown,
  form: FormData
) {
  const code = form.get("code");
  const result = await as(await currentActor()).verifyConsentLinkCode({
    token,
    code: typeof code === "string" ? code : "",
  });
  if (!result.ok) return result;
  const jar = await cookies();
  jar.set(ANSWER_COOKIE, result.sessionToken, {
    path: consentLinkPath(token),
    maxAge: ANSWER_WINDOW_MS / 1000,
    sameSite: "strict",
    httpOnly: true,
    secure: appEnv() !== "local",
  });
  redirect(consentLinkPath(token));
}

export async function saveAnswersAction(
  token: string,
  _previous: unknown,
  form: FormData
) {
  const jar = await cookies();
  const answers: Record<string, unknown> = Object.create(null);
  // Keep unexpected choices and reject repeated fields at the use-case seam.
  for (const [field, answer] of form.entries()) {
    if (!field.startsWith("answer:")) continue;
    const purpose = field.slice("answer:".length);
    answers[purpose] = Object.hasOwn(answers, purpose) ? null : answer;
  }
  const sessionToken = jar.get(ANSWER_COOKIE)?.value;
  const result = await as(await currentActor()).answerConsentLink({
    token,
    ...(sessionToken ? { sessionToken } : {}),
    answers,
  });
  if (!result.ok) return result;
  jar.set(ANSWER_COOKIE, "", {
    path: consentLinkPath(token),
    maxAge: 0,
    sameSite: "strict",
    httpOnly: true,
    secure: appEnv() !== "local",
  });
  redirect(`${consentLinkPath(token)}?done=1`);
}
