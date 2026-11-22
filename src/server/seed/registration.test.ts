import { describe, expect, it } from "vitest";

import { institutionRegistration } from "@/server/db/schema";
import { createHarness } from "@/test/harness";
import { seedInstitution } from "@/test/institutions";

import { SEED_COORDINATORS } from "./coordinators";
import { SEED_REGISTRATIONS } from "./registration";
import { SEED_SCOPES } from "./scopes";

describe("the registration seed", () => {
  it("registers the seeded verified institution for the seeded open competition, once however often it runs", async () => {
    const h = await createHarness();
    await h.seed.preview();
    await h.seed.preview();

    expect(await h.db.select().from(institutionRegistration)).toEqual([
      expect.objectContaining({
        id: SEED_REGISTRATIONS.institution.id,
        institutionId: SEED_SCOPES.institution.id,
        competitionId: "01938a00-0000-7000-8000-000000002101",
        reference: "NEIGH27-I-5EED1",
        status: "active",
      }),
    ]);
  });

  it("shows the seeded coordinator the registration on the competitions list", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const coordinator = await h.signIn(SEED_COORDINATORS.coordinator);

    const list = await h.as(coordinator).listCompetitionsForInstitution({
      institutionId: SEED_SCOPES.institution.id,
    });

    expect(list.ok && list.competitions[0]).toMatchObject({
      code: "NEIGH27",
      window: "open",
      registration: { reference: "NEIGH27-I-5EED1" },
    });
  });

  it("gives tests a builder that registers an institution without a coordinator", async () => {
    const h = await createHarness();
    const { institution: x } = await seedInstitution(h);
    const competition = await h.seed.competition({
      status: "registration_open",
      participation: "institutions",
      code: "BUILD27",
    });

    const built = await h.seed.institutionRegistration({
      institutionId: x.id,
      competitionId: competition.id,
    });

    expect(built.reference).toMatch(/^BUILD27-I-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(await h.db.select().from(institutionRegistration)).toEqual([
      expect.objectContaining({
        id: built.id,
        institutionId: x.id,
        competitionId: competition.id,
        reference: built.reference,
        registeredBy: null,
      }),
    ]);
  });
});
