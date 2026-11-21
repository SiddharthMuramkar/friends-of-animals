import { describe, expect, it } from "vitest";

import { dashboardLinks } from "./dashboard-links";

const SCHOOL = "01938a00-0000-7000-8000-000000001001";
const OTHER_SCHOOL = "01938a00-0000-7000-8000-000000001002";
const PARTNER = "01938a00-0000-7000-8000-000000003001";

describe("dashboardLinks", () => {
  it("gives a member one link, to their own section", () => {
    expect(dashboardLinks([{ area: "member" }])).toEqual([
      { area: "member", section: "member", href: "/dashboard#member" },
    ]);
  });

  it("links every area, in the order given, one per institution and organisation", () => {
    expect(
      dashboardLinks([
        { area: "member" },
        { area: "admin" },
        { area: "institution", institutionId: SCHOOL },
        { area: "institution", institutionId: OTHER_SCHOOL },
        { area: "judge" },
        { area: "organisation", organisationId: PARTNER },
      ])
    ).toEqual([
      { area: "member", section: "member", href: "/dashboard#member" },
      { area: "admin", section: "admin", href: "/dashboard#admin" },
      {
        area: "institution",
        id: SCHOOL,
        section: `institution-${SCHOOL}`,
        href: `/dashboard#institution-${SCHOOL}`,
      },
      {
        area: "institution",
        id: OTHER_SCHOOL,
        section: `institution-${OTHER_SCHOOL}`,
        href: `/dashboard#institution-${OTHER_SCHOOL}`,
      },
      { area: "judge", section: "judge", href: "/dashboard#judge" },
      {
        area: "organisation",
        id: PARTNER,
        section: `organisation-${PARTNER}`,
        href: `/dashboard#organisation-${PARTNER}`,
      },
    ]);
  });

  it("gives every link a different section, so no two anchors clash", () => {
    const links = dashboardLinks([
      { area: "member" },
      { area: "admin" },
      { area: "institution", institutionId: SCHOOL },
      { area: "judge" },
      { area: "organisation", organisationId: SCHOOL },
    ]);
    expect(new Set(links.map((link) => link.section)).size).toBe(links.length);
  });
});
