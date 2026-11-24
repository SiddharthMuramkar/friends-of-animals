import { consentLinkPath } from "@/lib/app-routes";
import { appEnv } from "@/lib/site";

/** The answer credential stays in a cookie scoped to the link's own path. */
export const ANSWER_COOKIE = "foa-consent-answer";

export function answerCookieOptions(token: string) {
  return {
    path: consentLinkPath(token),
    sameSite: "strict",
    httpOnly: true,
    secure: appEnv() !== "local",
  } as const;
}
