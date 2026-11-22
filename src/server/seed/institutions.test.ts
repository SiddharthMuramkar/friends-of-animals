import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { institution, userRole } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { SEED_INSTITUTIONS } from "./institutions";

describe("seedInstitutions", () => {
  it("gives a preview one pending, one verified and one rejected institution, however often it runs", async () => {
    const h = await createHarness();

    await h.seed.preview();
    h.clock.advance({ days: 1 });
    await h.seed.preview();

    const rows = await h.db
      .select({
        id: institution.id,
        status: institution.status,
        institutionCode: institution.institutionCode,
      })
      .from(institution)
      .orderBy(asc(institution.status));
    expect(rows).toEqual([
      {
        id: SEED_INSTITUTIONS.pending.id,
        status: "pending_verification",
        institutionCode: null,
      },
      {
        id: SEED_INSTITUTIONS.verified.id,
        status: "verified",
        institutionCode: SEED_INSTITUTIONS.verified.institutionCode,
      },
      {
        id: SEED_INSTITUTIONS.rejected.id,
        status: "rejected",
        institutionCode: null,
      },
    ]);
  });

  it("makes the verified institution's authorised person its admin, who sees it with readable contact details", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const { admin } = SEED_INSTITUTIONS.verified;

    const grants = await h.db
      .select({ role: userRole.role, scopeId: userRole.scopeId })
      .from(userRole)
      .where(eq(userRole.userId, admin.id));
    expect(grants).toEqual([
      { role: "institution_admin", scopeId: SEED_INSTITUTIONS.verified.id },
    ]);

    const actor = await h.signIn(admin);
    expect(await h.as(actor).getMyInstitution()).toMatchObject({
      ok: true,
      institution: {
        id: SEED_INSTITUTIONS.verified.id,
        status: "verified",
        principalEmail: expect.stringMatching(/@example\.test$/),
        principalPhone: expect.stringMatching(/^\+919000000\d{3}$/),
      },
    });
  });

  it("shows the applicant their new registration after the rejected one", async () => {
    const h = await createHarness();
    await h.seed.preview();

    const actor = await h.signIn(SEED_INSTITUTIONS.pending.applicant);
    expect(await h.as(actor).getMyInstitution()).toMatchObject({
      institution: {
        id: SEED_INSTITUTIONS.pending.id,
        status: "pending_verification",
      },
    });
  });
});
