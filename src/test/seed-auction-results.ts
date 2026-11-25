// Shared preview fixtures for tests of the completed AUCT27 competition.
// Run the real seeders in dependency order, without seeding unrelated
// modules (and their outbox jobs) before each use-case test.
import { seedAccess } from "@/server/seed/access";
import { seedAuctions } from "@/server/seed/auctions";
import { seedFunctions } from "@/server/seed/builders";
import { seedCompetitions } from "@/server/seed/competitions";
import { seedCompetitionTerms } from "@/server/seed/competition-terms";
import { seedChildConsents, seedConsent } from "@/server/seed/consent";
import { seedGuardians } from "@/server/seed/guardians";
import { seedIdentity } from "@/server/seed/identity";
import { seedInstitutions } from "@/server/seed/institutions";
import { seedJudging } from "@/server/seed/judging";
import { seedParticipants } from "@/server/seed/participants";
import { seedRegistrations } from "@/server/seed/registration";
import { seedResults } from "@/server/seed/results";
import { seedSettings } from "@/server/seed/settings";

export const { seedPreview: seedAuctionResults } = seedFunctions([
  seedIdentity,
  seedAccess,
  seedCompetitions,
  seedJudging,
  seedConsent,
  seedCompetitionTerms,
  seedSettings,
  // The results seed includes the two pupils from this school registration.
  seedInstitutions,
  seedRegistrations,
  seedParticipants,
  seedGuardians,
  seedChildConsents,
  // The auction seed provides the actual entrants, artwork, lots and sales.
  seedAuctions,
  seedResults,
]);
