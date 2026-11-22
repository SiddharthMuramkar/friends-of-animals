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
import { seedCompetitions } from "./competitions";
import { seedCms } from "./cms";
import { seedConsent } from "./consent";
import { seedFiles } from "./files";
import { seedIdentity } from "./identity";
import { seedInstitutions } from "./institutions";
import { seedNotifications } from "./notifications";
import { seedPosts } from "./posts";
import { seedSecondFactor } from "./second-factor";
import { seedSettings } from "./settings";
import type { Seeder } from "./types";

export type { SeedDeps, Seeder } from "./types";
export type { SeedBuilders } from "./builders";
export { SEED_ACCOUNTS } from "./accounts";
export { SEED_SCOPES } from "./scopes";
export { SEED_COMPETITION_MANAGER } from "./competitions";

const seeders: readonly Seeder[] = [
  // One line per module (.gitattributes merges this file with union).
  seedIdentity,
  seedAccess,
  seedCompetitions,
  seedConsent,
  seedFiles,
  seedSecondFactor,
  seedSettings,
  seedInstitutions,
  seedNotifications,
  seedCms,
  seedPosts,
];

export const { seedPreview, createSeedBuilders } = seedFunctions(seeders);
