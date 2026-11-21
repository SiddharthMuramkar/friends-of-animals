// The preview seed and the seed builders, given the list of module seeders
// in ./index.ts. Kept out of index.ts, which .gitattributes merges with
// union, so that file holds only import and list lines. Loads under plain
// Node: relative imports only, no "server-only".

import type { Grant } from "../access/domain/roles";
import type { User } from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { ensureGrant } from "./access";
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
      for (const seed of seeders) await seed({ db: tx, clock: deps.clock });
    });
  }

  /** Builders for tests: each call makes a new record unless told otherwise. */
  function createSeedBuilders(deps: SeedDeps) {
    let members = 0;
    /** A verified account. Pass `email` or `name` to choose them. */
    function member(
      details: { name?: string; email?: string } = {}
    ): Promise<User> {
      members += 1;
      return ensureVerifiedAccount(deps, {
        name:
          details.name ?? MEMBER_NAMES[(members - 1) % MEMBER_NAMES.length]!,
        email: details.email ?? `test-member-${members}@example.test`,
      });
    }
    /** Gives `user` a grant (no audit entry: it is seed data). */
    async function grant(user: { id: string }, ...grants: Grant[]) {
      for (const each of grants) await ensureGrant(deps, user.id, each);
    }
    return {
      member,
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
      /** Everything `pnpm db:seed` puts in a preview database. */
      preview: () => seedPreview(deps),
    };
  }

  return { seedPreview, createSeedBuilders };
}

export type SeedBuilders = ReturnType<
  ReturnType<typeof seedFunctions>["createSeedBuilders"]
>;
