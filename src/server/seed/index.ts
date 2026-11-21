// Seed builders and the preview seed. Builders are server code shared by
// Seam 1 tests (through the harness) and `pnpm db:seed` (scripts/seed.ts);
// they never import Vitest. Loads under plain Node: relative imports only,
// no "server-only". The logic is in ./builders.ts; this file holds only
// import and list lines.
//
// A module with preview data adds one line to `seeders`, after the modules
// its data depends on.

import { seedAccess } from "./access";
import { seedFunctions } from "./builders";
import { seedConsent } from "./consent";
import { seedIdentity } from "./identity";
import { seedSecondFactor } from "./second-factor";
import type { Seeder } from "./types";

export type { SeedDeps, Seeder } from "./types";
export type { SeedBuilders } from "./builders";
export { SEED_ACCOUNTS } from "./accounts";
export { SEED_SCOPES } from "./scopes";

const seeders: readonly Seeder[] = [
  // One line per module (.gitattributes merges this file with union).
  seedIdentity,
  seedAccess,
  seedConsent,
  seedSecondFactor,
];

export const { seedPreview, createSeedBuilders } = seedFunctions(seeders);
