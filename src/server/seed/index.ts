// Seed builders and the preview seed. Builders are server code shared by
// Seam 1 tests (through the harness) and `pnpm db:seed` (scripts/seed.ts);
// they never import Vitest. Loads under plain Node: relative imports only,
// no "server-only". The logic is in ./builders.ts; this file holds only
// import and list lines.
//
// A module with preview data adds one line to `seeders`, after the modules
// its data depends on.

import { seedAccess } from "./access";
import { seedAnnouncements } from "./announcements";
import { seedFunctions } from "./builders";
import { seedCompetitionTerms } from "./competition-terms";
import { seedCoordinators } from "./coordinators";
import { seedCompetitions } from "./competitions";
import { seedCms } from "./cms";
import { seedChildConsents, seedConsent } from "./consent";
import { seedConsentForms } from "./consent-forms";
import { seedConsentLinks } from "./consent-links";
import { seedConsentLinkTemplates } from "./consent-link-templates";
import { seedContact } from "./contact";
import { seedRecurringDonations } from "./recurring-donations";
import { seedDonations, seedTransparencyDonations } from "./donations";
import { seedOfflineDonations } from "./offline-donations";
import { seedDirectory } from "./directory";
import { seedAdoption } from "./adoption";
import { seedAdoptionApplications } from "./adoption-applications";
import { seedEntries } from "./entries";
import { seedInstitutionSubmissions } from "./institution-submissions";
import { seedSchoolRound } from "./school-round";
import { seedFiles } from "./files";
import { seedGuardians } from "./guardians";
import { seedBreaches } from "./breaches";
import { seedLedger } from "./ledger";
import { seedLedgerPeriods } from "./ledger-periods";
import { seedBudgets } from "./ledger-budgets";
import { seedIdentity } from "./identity";
import { seedJudgingRounds } from "./judging-rounds";
import { seedJudging } from "./judging";
import { seedSafeguarding } from "./safeguarding";
import { seedInstitutions } from "./institutions";
import { seedNotifications } from "./notifications";
import { seedRegistrations } from "./registration";
import { seedPayments } from "./payments";
import { seedRefunds } from "./refunds";
import { seedCancelledCompetition } from "./competition-cancelled";
import { seedParticipants } from "./participants";
import { seedPosts } from "./posts";
import { importRepoStories } from "./posts-import";
import { seedPrivacy } from "./privacy";
import { seedSecondFactor } from "./second-factor";
import { seedCertificates } from "./certificates";
import { seedResults } from "./results";
import { seedAuctions } from "./auctions";
import { seedPhysicalArtwork } from "./physical-artwork";
import { seedReminders } from "./reminders";
import { seedScoring } from "./scoring";
import { seedSettings } from "./settings";
import { seedVolunteers } from "./volunteers";
import type { Seeder } from "./types";

export type { SeedDeps, Seeder } from "./types";
export type { SeedBuilders } from "./builders";
export { SEED_ACCOUNTS } from "./accounts";
export { SEED_SCOPES } from "./scopes";
export { SEED_COMPETITION_MANAGER } from "./competitions";
export { SEED_DIRECTORY } from "./directory";
export { SEED_ADOPTION } from "./adoption";
export { SEED_ADOPTION_APPLICATIONS } from "./adoption-applications";

const seeders: readonly Seeder[] = [
  // One line per module (.gitattributes merges this file with union).
  seedIdentity,
  seedAccess,
  seedCompetitions,
  seedJudging,
  seedConsent,
  seedConsentLinkTemplates,
  seedCompetitionTerms,
  seedFiles,
  seedSecondFactor,
  seedSettings,
  seedSafeguarding,
  // After the identity and access seeds: the seeded members (#116).
  seedBreaches,
  seedInstitutions,
  // After the identity and access seeds: its own seeded members (#127).
  seedDirectory,
  // After the directory seed: its listings offer the animals (#129).
  seedAdoption,
  seedPrivacy,
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
  // After the registration seed: a cancelled competition with one of its
  // students refunded and one cancelled (#80).
  seedCancelledCompetition,
  // After the competitions, their terms and the accounts: adults who
  // registered themselves for NEIGH27, one paid.
  seedParticipants,
  // After the participants seed: Asha's entries, one per outcome (#85).
  seedEntries,
  // After the institutions, competitions and entries seeds: the school's
  // TREES27 students and their entries, for the coordinator roster (#87).
  seedInstitutionSubmissions,
  // After the payments, refunds and judging seeds: Kinder Skies' paid
  // students' entries and the school's open round (#89).
  seedSchoolRound,
  // After the participants seed: a guardian, their under-13 child and a
  // teen whose own login is linked to them (#81).
  seedGuardians,
  // Before the ledger seed, whose reconcile posts its donations (#106).
  seedDonations,
  seedOfflineDonations,
  seedRecurringDonations,
  seedTransparencyDonations,
  seedLedger,
  // After the ledger seed: its postings are in open months (#109).
  seedLedgerPeriods,
  seedBudgets,
  // After the guardians seed: their children's consents, registered for
  // NEIGH27 (#82).
  seedChildConsents,
  seedPhysicalArtwork,
  seedAuctions,
  seedResults,
  seedCertificates,
  seedScoring,
  seedJudgingRounds,
  // After the consent and guardians seeds: the declarations and the
  // linked teen (#123).
  seedVolunteers,
  // After the adoption and consent seeds: applications on the seeded
  // animals, on version 1 of the adopter's consents (#130).
  seedAdoptionApplications,
  seedConsentLinks,
  // After every registration seed: the sent one's count comes from them.
  seedAnnouncements,
  // After every competition seed: their reminders, as publishing plans them (#84).
  seedReminders,
  seedNotifications,
  seedContact,
  seedCms,
  seedPosts,
  importRepoStories,
];

export const { seedPreview, createSeedBuilders } = seedFunctions(seeders);
