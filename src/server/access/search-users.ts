// Finding a user to manage their roles (#59): by the start of their email
// address or any part of their name. Phone numbers join with #58's blind
// index.

import { asc, ilike, like, or } from "drizzle-orm";
import { z } from "zod";

import { user } from "../db/schema";
import { invalidInput, type InvalidInput } from "../input";
import { normaliseEmailAddress } from "../ports/email";
import { authorize } from "./can";
import type { AccessContext } from "./manage-roles";

/** At most this many users per search. */
export const USER_SEARCH_LIMIT = 20;

export type FoundUser = { id: string; name: string; email: string };

export type SearchUsersResult = { ok: true; users: FoundUser[] } | InvalidInput;

const searchUsersInput = z.object({
  query: z.string().trim().min(2).max(100),
});

/** `text` for LIKE, with its wildcards and escape character taken literally. */
function literal(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Users whose email starts with the query, or whose name contains it, in
 * name order. Not the middle of an address, so a search can't list
 * everyone at one domain.
 */
export async function searchUsers(
  ctx: AccessContext,
  input: { query: string }
): Promise<SearchUsersResult> {
  await authorize(ctx, "user.search");
  const parsed = searchUsersInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { query } = parsed.data;

  const users = await ctx.db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(
      or(
        like(user.email, `${literal(normaliseEmailAddress(query))}%`),
        ilike(user.name, `%${literal(query)}%`)
      )
    )
    .orderBy(asc(user.name), asc(user.email))
    .limit(USER_SEARCH_LIMIT);
  return { ok: true, users };
}
