// A signed-in user's own account, and helpers the session use cases share.

import { eq } from "drizzle-orm";

import { authorize } from "../access/can";
import { user } from "../db/schema";
import type { UseCaseContext } from "../use-cases";
import { authFor } from "./auth";

export type Account = { name: string; email: string };

/** The signed-in user; `authorize` has ruled out other actors. */
export function signedInUser(ctx: UseCaseContext) {
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  return ctx.actor;
}

export async function getAccount(ctx: UseCaseContext): Promise<Account> {
  await authorize(ctx, "getAccount");
  const { userId } = signedInUser(ctx);
  const [account] = await ctx.db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  if (!account) throw new Error("The signed-in user has no account row");
  return account;
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
