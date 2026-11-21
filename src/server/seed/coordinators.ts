// Coordinators seed data (#74): on the seeded verified institution, a
// coordinator and one invitation still waiting, under fixed ids so links
// and journeys can name them. Loads under plain Node (the seed script):
// relative imports only, no "server-only".

import { SEED_ACCOUNTS } from "./accounts";
import { SEED_SCOPES } from "./scopes";

export const SEED_COORDINATORS = {
  institution: SEED_SCOPES.institution,
  /** PROVISIONAL until #73 seeds the institution and its authorised person. */
  principal: {
    id: "01938a00-0000-7000-8000-000000000201",
    name: "Seed Principal",
    email: "principal@example.test",
  },
  /** Member 1 already coordinates there (./access.ts); kept so here too. */
  coordinator: SEED_ACCOUNTS.members[0],
  invitation: {
    id: "01938a00-0000-7000-8000-000000004001",
    email: "invited-teacher@example.test",
  },
} as const;
