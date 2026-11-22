import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

const SCHOOL_A = "01938a00-0000-7000-8000-00000000a001";
const COMPETITION = "01938a00-0000-7000-8000-00000000c001";

describe("myAccess", () => {
  it("shows a user with several roles every dashboard they open", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    await h.seed.grant(
      member,
      { role: "judge", scope: { type: "competition", id: COMPETITION } },
      { role: "content_manager", scope: { type: "global" } },
      {
        role: "institution_coordinator",
        scope: { type: "institution", id: SCHOOL_A },
      }
    );

    expect(await h.as(await h.signIn(member)).myAccess()).toEqual({
      grants: [
        { role: "content_manager", scope: { type: "global" } },
        {
          role: "institution_coordinator",
          scope: { type: "institution", id: SCHOOL_A },
        },
        { role: "judge", scope: { type: "competition", id: COMPETITION } },
      ],
      dashboards: [
        { area: "member" },
        { area: "admin" },
        { area: "institution", institutionId: SCHOOL_A },
        { area: "judge" },
      ],
    });
  });

  it("shows a member with no roles the member dashboard alone", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());

    expect(await h.as(member).myAccess()).toEqual({
      grants: [],
      dashboards: [{ area: "member" }],
    });
  });

  it("reflects a grant at once, for a session already open", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const member = await h.seed.member();
    const memberActor = await h.signIn(member);

    await h.as(admin).grantRole({
      userId: member.id,
      role: "institution_coordinator",
      scope: { type: "institution", id: SCHOOL_A },
    });

    expect((await h.as(memberActor).myAccess()).dashboards).toEqual([
      { area: "member" },
      { area: "institution", institutionId: SCHOOL_A },
    ]);
  });

  it("refuses a visitor", async () => {
    const h = await createHarness();
    await expect(h.as(h.visitor()).myAccess()).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
