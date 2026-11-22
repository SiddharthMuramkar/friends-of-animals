// The acting user's own verified email (#81): where a guardian's code goes,
// and what a teen invitation is matched against. Loads under plain Node:
// relative imports only, no "server-only".

import { eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { user } from "../../db/schema";

/**
 * The user's email if they have verified it, else null. Stored normalised
 * (check `user_email_normalised`), so it matches a normalised invited
 * address as it is.
 */
export async function verifiedEmailOf(
  db: AppDb,
  userId: string
): Promise<string | null> {
  const [row] = await db
    .select({ email: user.email, verified: user.emailVerified })
    .from(user)
    .where(eq(user.id, userId));
  return row?.email && row.verified ? row.email : null;
}
