"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { consentLinkPath } from "@/lib/app-routes";
import { appEnv } from "@/lib/site";
import { as, currentActor } from "@/server/app";
import { isWellFormedLinkToken } from "@/server/crypto/link-token";

import { ANSWER_COOKIE } from "./cookie";

const linkToken = z.string().refine(isWellFormedLinkToken);
const formData = z.instanceof(FormData);
const NOT_FOUND = { ok: false, error: "not_found" } as const;

export async function sendCodeAction(boundToken: unknown) {
  const parsed = linkToken.safeParse(boundToken);
  if (!parsed.success) return NOT_FOUND;
  const token = parsed.data;
  const result = await as(await currentActor()).sendConsentLinkCode({ token });
  if (result.ok) redirect(consentLinkPath(token));
  return result;
}

export async function verifyCodeAction(
  boundToken: unknown,
  _previous: unknown,
  form: unknown
) {
  const parsed = linkToken.safeParse(boundToken);
  if (!parsed.success) return NOT_FOUND;
  const submitted = formData.safeParse(form);
  if (!submitted.success) return { ok: false, error: "invalid_code" } as const;
  const token = parsed.data;
  const codes = submitted.data.getAll("code");
  const [code] = codes;
  const result = await as(await currentActor()).verifyConsentLinkCode({
    token,
    code: codes.length === 1 && typeof code === "string" ? code : "",
  });
  if (!result.ok) return result;
  const jar = await cookies();
  jar.set(ANSWER_COOKIE, result.sessionToken, {
    path: consentLinkPath(token),
    expires: result.answerBy,
    sameSite: "strict",
    httpOnly: true,
    secure: appEnv() !== "local",
  });
  redirect(consentLinkPath(token));
}

export async function saveAnswersAction(
  boundToken: unknown,
  _previous: unknown,
  form: unknown
) {
  const parsed = linkToken.safeParse(boundToken);
  if (!parsed.success) return NOT_FOUND;
  const submitted = formData.safeParse(form);
  if (!submitted.success)
    return { ok: false, error: "invalid_answer" } as const;
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
