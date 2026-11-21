// What the email and phone sign-in use cases share: input checks, their
// "invalid input" result, the visitor's request details and storing the
// session cookie Better Auth sets.

import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";
import { z } from "zod";

import type { RequestMeta } from "../actor";
import type { CookieJar } from "../ports/cookies";
import type { UseCaseContext } from "../use-cases";
import { EMAIL_CODE } from "./settings";

export const codeInput = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${EMAIL_CODE.length}}$`));

export const nameInput = z.string().trim().min(1).max(100);

export { invalidInput, type InvalidInput } from "../input";

/** The visitor's request details; `authorize` has ruled out other actors. */
export function visitorMeta(ctx: UseCaseContext): RequestMeta {
  if (ctx.actor.kind !== "visitor") throw new Error("unreachable");
  return ctx.actor.meta;
}

/** Puts the cookies from Better Auth's response in the browser's jar. */
export async function storeCookies(jar: CookieJar, headers: Headers) {
  const setCookie = headers.get("set-cookie");
  if (!setCookie) return;
  for (const [name, attributes] of parseSetCookieHeader(setCookie)) {
    await jar.set(name, attributes.value, toCookieOptions(attributes));
  }
}
