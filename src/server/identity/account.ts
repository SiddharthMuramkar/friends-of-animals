// A signed-in user's own account, and helpers the session use cases share.

import { eq } from "drizzle-orm";

import type { E164Phone } from "@/lib/phone";

import { user } from "../db/schema";
import type { UseCaseContext } from "../use-cases";
import { authFor } from "./auth";
import { authorize } from "./policy";
import { readStoredPhone } from "./stored-phone";

/** An account has an email, a phone, or both. */
export type Account = {
  name: string;
  email: string | null;
  phone: E164Phone | null;
};

/** The signed-in user; `authorize` has ruled out other actors. */
export function signedInUser(ctx: UseCaseContext) {
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  return ctx.actor;
}

export async function getAccount(ctx: UseCaseContext): Promise<Account> {
  authorize(ctx.actor, "getAccount");
  const { userId } = signedInUser(ctx);
  const [account] = await ctx.db
    .select({
      name: user.name,
      email: user.email,
      phoneCiphertext: user.phoneCiphertext,
    })
    .from(user)
    .where(eq(user.id, userId));
  if (!account) throw new Error("The signed-in user has no account row");
  return {
    name: account.name,
    email: account.email,
    phone: account.phoneCiphertext
      ? readStoredPhone(ctx, account.phoneCiphertext)
      : null,
  };
}

/** Removes the browser's session cookie. */
export async function expireSessionCookie(ctx: UseCaseContext): Promise<void> {
  const { name, attributes } = (await authFor(ctx).$context).authCookies
    .sessionToken;
  await ctx.cookies.set(name, "", {
    path: attributes.path,
    secure: attributes.secure,
    httpOnly: attributes.httpOnly,
    sameSite: attributes.sameSite?.toLowerCase() as
      | "strict"
      | "lax"
      | "none"
      | undefined,
    maxAge: 0,
  });
}
