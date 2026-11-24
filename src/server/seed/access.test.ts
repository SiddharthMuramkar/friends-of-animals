import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { userRole } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { SEED_ACCOUNTS, SEED_SCOPES } from "./index";

describe("the access seed", () => {
  it("makes the seeded super admin a global super admin", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const admin = await h.signIn(SEED_ACCOUNTS.superAdmin);

    expect(
      await h.as(admin).listUserRoles({ userId: SEED_ACCOUNTS.superAdmin.id })
    ).toMatchObject({
      ok: true,
      grants: [{ role: "super_admin", scope: { type: "global" } }],
    });
  });

  it("gives one member several roles across global, school and competition scopes", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const [asha] = SEED_ACCOUNTS.members;
    const actor = await h.signIn(asha);

    expect(await h.as(actor).myAccess()).toEqual({
      grants: [
        { role: "content_manager", scope: { type: "global" } },
        {
          role: "institution_coordinator",
          scope: { type: "institution", id: SEED_SCOPES.institution.id },
        },
        {
          role: "judge",
          scope: { type: "competition", id: SEED_SCOPES.competition.id },
        },
      ],
      dashboards: [
        { area: "member" },
        { area: "admin" },
        { area: "institution", institutionId: SEED_SCOPES.institution.id },
        { area: "judge" },
      ],
    });
  });

  it("seeds a staff admin, and a member with no roles to grant some to", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const [, ravi, meera] = SEED_ACCOUNTS.members;

    expect(await h.as(await h.signIn(ravi)).myAccess()).toMatchObject({
      grants: [{ role: "staff_admin", scope: { type: "global" } }],
    });
    expect(await h.as(await h.signIn(meera)).myAccess()).toMatchObject({
      grants: [],
    });
  });

  it("changes nothing when it runs again", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const rows = () => h.db.select().from(userRole).orderBy(asc(userRole.id));
    const first = await rows();

    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(await rows()).toEqual(first);
    // Five from this seeder, two from the competitions seeder's managers,
    // two from the consent seeder's publishers, two from the
    // notifications seeder's template editors, the seeded institution's
    // admin (#73), the safeguarding seeder's lead (#116), and the
    // guardians seeder's guardian and linked teen (#81), plus Ledger Finance,
    // the volunteers seeder's community manager and volunteer (#123), and
    // the directory seeder's three representatives (#127).
    expect(first).toHaveLength(21);
  });

  it("keeps fixed scope ids that links and journeys can name", () => {
    expect(SEED_SCOPES).toEqual({
      institution: {
        id: "01938a00-0000-7000-8000-000000001001",
        name: "Seed Public School",
      },
      competition: {
        id: "01938a00-0000-7000-8000-000000002001",
        name: "Seed Drawing Competition",
      },
      organisation: {
        id: "01938a00-0000-7000-8000-000000003001",
        name: "Seed Partner Organisation",
      },
    });
  });
});
