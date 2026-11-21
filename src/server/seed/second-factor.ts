// Second-factor seed data (#60): every seeded staff account gets an
// authenticator app with one known secret, so a preview's journeys (and a
// person trying a preview) can type its codes. Seeds run only on previews
// and local databases (./target.ts), never staging or production, so the
// secret below never guards a real account. Loads under plain Node (the
// seed script): relative imports only, no "server-only".

import { and, eq, isNotNull } from "drizzle-orm";

import { isStaffRole } from "../access/domain/roles";
import { grantsOf } from "../access/grants";
import { secondFactor } from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { uuidv7 } from "../ids";
import { base32Decode } from "../second-factor/domain/base32";
import { openTotpSecret, sealTotpSecret } from "../second-factor/secret-box";
import { SEED_ACCOUNTS } from "./accounts";
import type { SeedDeps } from "./types";

/**
 * The base32 key of every seeded authenticator. Public on purpose: add it
 * to an authenticator app, or compute codes from it in a test.
 */
export const SEED_TOTP_SECRET = "FOAPREVIEWSEEDTOTPSECRETKEY23456";

export const SEED_FACTOR_LABEL = "Seed authenticator";

function opens(authSecret: string, factorId: string, sealed: string | null) {
  if (!sealed) return false;
  try {
    openTotpSecret(authSecret, factorId, sealed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gives `userId` a confirmed authenticator with SEED_TOTP_SECRET, unless
 * they have one that still opens. One sealed under an earlier
 * BETTER_AUTH_SECRET is sealed again under the current one.
 */
export async function ensureSeedAuthenticator(
  { db, clock, auth }: SeedDeps,
  userId: string
): Promise<void> {
  const now = clock.now();
  const secret = base32Decode(SEED_TOTP_SECRET);
  const existing = await db
    .select({ id: secondFactor.id, sealed: secondFactor.totpSecretSealed })
    .from(secondFactor)
    .where(
      and(
        eq(secondFactor.userId, userId),
        eq(secondFactor.kind, "totp"),
        eq(secondFactor.label, SEED_FACTOR_LABEL),
        isNotNull(secondFactor.confirmedAt)
      )
    );
  if (existing.some((factor) => opens(auth.secret, factor.id, factor.sealed))) {
    return;
  }
  for (const factor of existing) {
    await db
      .update(secondFactor)
      .set({ totpSecretSealed: sealTotpSecret(auth.secret, factor.id, secret) })
      .where(eq(secondFactor.id, factor.id));
  }
  if (existing.length > 0) return;
  const id = uuidv7(now);
  await db.insert(secondFactor).values({
    id,
    userId,
    kind: "totp",
    label: SEED_FACTOR_LABEL,
    confirmedAt: now,
    totpSecretSealed: sealTotpSecret(auth.secret, id, secret),
    createdAt: now,
  });
}

/** An authenticator for each seeded account holding a staff role. */
export async function seedSecondFactor(deps: SeedDeps): Promise<void> {
  for (const account of [SEED_ACCOUNTS.superAdmin, ...SEED_ACCOUNTS.members]) {
    const { id } = await ensureVerifiedAccount(deps, account);
    const grants = await grantsOf(deps.db, id);
    if (grants.some((grant) => isStaffRole(grant.role))) {
      await ensureSeedAuthenticator(deps, id);
    }
  }
}
