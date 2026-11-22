import { describe, expect, it } from "vitest";

import { dashboardsFor } from "./dashboards";
import type { Grant } from "./roles";

const INST_A = "01938a00-0000-7000-8000-00000000a001";
const INST_B = "01938a00-0000-7000-8000-00000000a002";
const ORG = "01938a00-0000-7000-8000-00000000b001";
const COMP = "01938a00-0000-7000-8000-00000000c001";

describe("dashboardsFor", () => {
  it("gives a user with no roles the member dashboard only", () => {
    expect(dashboardsFor([])).toEqual([{ area: "member" }]);
  });

  it("gives every staff role one admin dashboard", () => {
    const grants: Grant[] = [
      { role: "finance", scope: { type: "global" } },
      { role: "super_admin", scope: { type: "global" } },
    ];
    expect(dashboardsFor(grants)).toEqual([
      { area: "member" },
      { area: "admin" },
    ]);
  });

  it("gives one institution dashboard per institution, whichever school role", () => {
    const grants: Grant[] = [
      {
        role: "institution_coordinator",
        scope: { type: "institution", id: INST_B },
      },
      { role: "institution_admin", scope: { type: "institution", id: INST_A } },
      {
        role: "institution_coordinator",
        scope: { type: "institution", id: INST_A },
      },
    ];
    expect(dashboardsFor(grants)).toEqual([
      { area: "member" },
      { area: "institution", institutionId: INST_A },
      { area: "institution", institutionId: INST_B },
    ]);
  });

  it("lists every area of a user with several roles in a fixed order", () => {
    const grants: Grant[] = [
      {
        role: "organisation_representative",
        scope: { type: "organisation", id: ORG },
      },
      { role: "judge", scope: { type: "competition", id: COMP } },
      { role: "institution_admin", scope: { type: "institution", id: INST_A } },
      { role: "staff_admin", scope: { type: "global" } },
      { role: "guardian", scope: { type: "global" } },
    ];
    expect(dashboardsFor(grants)).toEqual([
      { area: "member" },
      { area: "admin" },
      { area: "institution", institutionId: INST_A },
      { area: "judge" },
      { area: "organisation", organisationId: ORG },
    ]);
  });

  it("keeps member-side roles on the member dashboard", () => {
    const grants: Grant[] = [
      { role: "participant", scope: { type: "competition", id: COMP } },
      { role: "guardian", scope: { type: "global" } },
      { role: "volunteer", scope: { type: "global" } },
    ];
    expect(dashboardsFor(grants)).toEqual([{ area: "member" }]);
  });
});
