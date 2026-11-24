import { describe, expect, it } from "vitest";

import {
  AUTHORITY_REFERENCE_MAX,
  planAuthorityNotice,
} from "./authority-notice";

describe("planAuthorityNotice", () => {
  it("emails the configured address", () => {
    expect(
      planAuthorityNotice({ authorityEmail: " dpb-intake@example.test " })
    ).toEqual({ kind: "email", to: "dpb-intake@example.test" });
  });

  it("emails even when a manual reference was also typed", () => {
    expect(
      planAuthorityNotice({
        authorityEmail: "dpb-intake@example.test",
        manualReference: "DPB/2027/77",
      })
    ).toEqual({ kind: "email", to: "dpb-intake@example.test" });
  });

  it("records the manual reference when no address is set", () => {
    for (const authorityEmail of [null, "", "  "]) {
      expect(
        planAuthorityNotice({
          authorityEmail,
          manualReference: " DPB/2027/77 ",
        })
      ).toEqual({ kind: "manual", reference: "DPB/2027/77" });
    }
  });

  it("caps a manual reference's length", () => {
    const plan = planAuthorityNotice({
      authorityEmail: null,
      manualReference: "R".repeat(AUTHORITY_REFERENCE_MAX + 50),
    });
    expect(plan).toEqual({
      kind: "manual",
      reference: "R".repeat(AUTHORITY_REFERENCE_MAX),
    });
  });

  it("refuses when there is neither an address nor a reference", () => {
    expect(planAuthorityNotice({ authorityEmail: null })).toEqual({
      kind: "refused",
      reason: "authority_unconfigured",
    });
    expect(
      planAuthorityNotice({ authorityEmail: "", manualReference: "   " })
    ).toEqual({ kind: "refused", reason: "authority_unconfigured" });
  });
});
