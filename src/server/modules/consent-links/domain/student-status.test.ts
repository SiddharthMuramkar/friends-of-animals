import { describe, expect, it } from "vitest";

import { studentConsentStatus, type UseState } from "./student-status";

const uses = (
  display: UseState["status"],
  social: UseState["status"]
): UseState[] => [
  { purpose: "public_display", status: display },
  { purpose: "social_media", status: social },
];

describe("studentConsentStatus", () => {
  it("starts with no link and no public use", () => {
    expect(studentConsentStatus(null, uses("never", "never"))).toEqual({
      link: "not_sent",
      publicUse: "none",
      given: [],
      canSendLink: true,
    });
  });

  it("counts given uses only, withdrawn ones are not given", () => {
    expect(
      studentConsentStatus("answered", uses("given", "withdrawn"))
    ).toMatchObject({ publicUse: "some", given: ["public_display"] });
    expect(
      studentConsentStatus("answered", uses("given", "given"))
    ).toMatchObject({ publicUse: "all" });
  });

  it("lets the coordinator send again except while a guardian answers", () => {
    for (const link of [
      "sent",
      "opened",
      "answered",
      "expired",
      "revoked",
    ] as const) {
      expect(
        studentConsentStatus(link, uses("never", "never")).canSendLink
      ).toBe(true);
    }
    expect(
      studentConsentStatus("verified", uses("never", "never")).canSendLink
    ).toBe(false);
  });

  it("has no public use when none is offered", () => {
    expect(studentConsentStatus("sent", [])).toMatchObject({
      publicUse: "none",
    });
  });
});
