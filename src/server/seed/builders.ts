// The preview seed and the seed builders, given the list of module seeders
// in ./index.ts. Kept out of index.ts, which .gitattributes merges with
// union, so that file holds only import and list lines. Loads under plain
// Node: relative imports only, no "server-only".

import type { Grant } from "../access/domain/roles";
import { user } from "../db/schema";
import { storedPhone } from "../identity/stored-phone";
import {
  ensureVerifiedAccount,
  type VerifiedAccount,
} from "../identity/verified-account";
import { uuidv7 } from "../ids";
import { normaliseEmailAddress } from "../ports/email";
import { ensureGrant } from "./access";
import { eventBuilder } from "./events";
import { competitionBuilder } from "./competitions";
import { directoryListingBuilder, pincodeCentresBuilder } from "./directory";
import { guardianBuilder } from "./guardians";
import { seedPhone } from "./identity";
import { institutionRegistrationBuilder } from "./registration";
import { ensureSeedAuthenticator } from "./second-factor";
import type { SeedDeps, Seeder } from "./types";

const MEMBER_NAMES = [
  "Priya Sharma",
  "Arjun Menon",
  "Fatima Shaikh",
  "Rohan Das",
  "Ananya Gupta",
  "Kabir Singh",
];

/** `seedPreview` and `createSeedBuilders` over `seeders`, run in order. */
export function seedFunctions(seeders: readonly Seeder[]) {
  /**
   * Fills a preview or local database with the seed data. Idempotent:
   * preview databases live across pushes to a PR, so every push runs it
   * again.
   */
  async function seedPreview(deps: SeedDeps): Promise<void> {
    await deps.db.transaction(async (tx) => {
      for (const seed of seeders) await seed({ ...deps, db: tx });
    });
  }

  /** Builders for tests: each call makes a new record unless told otherwise. */
  function createSeedBuilders(deps: SeedDeps) {
    let members = 0;
    /**
     * A verified account. Pass `email` or `name` to choose them, and
     * `phone` (an Indian mobile, typed any usual way) to give it one.
     */
    async function member(
      details: { name?: string; email?: string; phone?: string } = {}
    ): Promise<VerifiedAccount> {
      members += 1;
      return ensureVerifiedAccount(deps, {
        name:
          details.name ?? MEMBER_NAMES[(members - 1) % MEMBER_NAMES.length]!,
        email: details.email ?? `test-member-${members}@example.test`,
        phone:
          details.phone === undefined
            ? undefined
            : storedPhone(deps, seedPhone(details.phone)),
      });
    }
    /** Gives `user` a grant (no audit entry: it is seed data). */
    async function grant(user: { id: string }, ...grants: Grant[]) {
      for (const each of grants) await ensureGrant(deps, user.id, each);
    }
    return {
      member,
      /** An account with a stored email awaiting verification. */
      async pendingEmailAccount(details: { name: string; email: string }) {
        const now = deps.clock.now();
        const id = uuidv7(now);
        const email = normaliseEmailAddress(details.email);
        await deps.db.insert(user).values({
          id,
          name: details.name,
          email,
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
        });
        return { id, email };
      },
      grant,
      /** A verified account holding the global super admin role. */
      async superAdmin(details: { name?: string; email?: string } = {}) {
        const account = await member(details);
        await grant(account, {
          role: "super_admin",
          scope: { type: "global" },
        });
        return account;
      },
      /**
       * Gives `user` a confirmed authenticator app with SEED_TOTP_SECRET
       * (no audit entry: it is seed data).
       */
      authenticator: (user: { id: string }) =>
        ensureSeedAuthenticator(deps, user.id),
      /** A complete competition (draft unless told), no audit entry. */
      competition: competitionBuilder(deps),
      event: eventBuilder(deps),
      /** An institution registered for a competition: no checks, no message. */
      institutionRegistration: institutionRegistrationBuilder(deps),
      /**
       * A verified guardian (#81) with the children asked for, by name and
       * age today; none with a login. No code, no audit entry.
       */
      guardian: guardianBuilder(deps),
      /**
       * A directory listing (#127), verified unless told, by a new member
       * who represents it. No audit entry, no message.
       */
      directoryListing: directoryListingBuilder(deps),
      /** Pin-code centres for the directory search (#128), saved as given. */
      pincodeCentres: pincodeCentresBuilder(deps),
      /** Everything `pnpm db:seed` puts in a preview database. */
      preview: () => seedPreview(deps),
    };
  }

  return { seedPreview, createSeedBuilders };
}

export type SeedBuilders = ReturnType<
  ReturnType<typeof seedFunctions>["createSeedBuilders"]
>;
