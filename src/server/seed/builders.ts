// The preview seed and the seed builders, given the list of module seeders
// in ./index.ts. Kept out of index.ts, which .gitattributes merges with
// union, so that file holds only import and list lines. Loads under plain
// Node: relative imports only, no "server-only".

import type { User } from "../db/schema";
import { ensureAccount } from "./identity";
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
    return {
      /** A verified account. Pass `email` or `name` to choose them. */
      member(details: { name?: string; email?: string } = {}): Promise<User> {
        members += 1;
        return ensureAccount(deps, {
          name:
            details.name ?? MEMBER_NAMES[(members - 1) % MEMBER_NAMES.length]!,
          email: details.email ?? `test-member-${members}@example.test`,
        });
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
