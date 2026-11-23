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
import { seedCompetitionTerms } from "./competition-terms";
import { seedCoordinators } from "./coordinators";
import { seedCompetitions } from "./competitions";
import { seedCms } from "./cms";
import { seedChildConsents, seedConsent } from "./consent";
import { seedConsentForms } from "./consent-forms";
import { seedContact } from "./contact";
import { seedFiles } from "./files";
import { seedGuardians } from "./guardians";
import { seedLedger } from "./ledger";
import { seedIdentity } from "./identity";
import { seedJudging } from "./judging";
import { seedSafeguarding } from "./safeguarding";
import { seedInstitutions } from "./institutions";
import { seedNotifications } from "./notifications";
import { seedRegistrations } from "./registration";
import { seedPayments } from "./payments";
import { seedRefunds } from "./refunds";
import { seedParticipants } from "./participants";
import { seedPosts } from "./posts";
import { importRepoStories } from "./posts-import";
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
  seedJudging,
  seedConsent,
  seedCompetitionTerms,
  seedFiles,
  seedSecondFactor,
  seedSettings,
  seedSafeguarding,
  seedInstitutions,
  // After the institutions seed: it needs the verified institution.
  seedCoordinators,
  // After the institutions and competitions seeds: it needs both.
  seedRegistrations,
  seedConsentForms,
  // After the registration seed: its batches hold those students.
  seedPayments,
  // After the payments seed: a refund waiting for finance on its paid
  // batch, and one refunded (#80).
  seedRefunds,
  // After the competitions, their terms and the accounts: adults who
  // registered themselves for NEIGH27, one paid.
  seedParticipants,
  // After the participants seed: a guardian, their under-13 child and a
  // teen whose own login is linked to them (#81).
  seedGuardians,
  seedLedger,
  // After the guardians seed: their children's consents, registered for
  // NEIGH27 (#82).
  seedChildConsents,
  seedNotifications,
  seedContact,
  seedCms,
  seedPosts,
  importRepoStories,
];

export const { seedPreview, createSeedBuilders } = seedFunctions(seeders);
