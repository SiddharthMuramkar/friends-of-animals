import { describe, expect, it } from "vitest";

import { decidePoolAdmission } from "./pool-admission";

describe("which entries a round's pool admits", () => {
  it.each([
    // judgesPhysical, foaVerified, physicallyReady, expected
    [true, true, true, { admitted: true }],
    [true, true, false, { admitted: false, reason: "not_physically_ready" }],
    [true, false, true, { admitted: false, reason: "not_foa_verified" }],
    [true, false, false, { admitted: false, reason: "not_foa_verified" }],
    [false, true, true, { admitted: true }],
    [false, true, false, { admitted: true }],
    [false, false, true, { admitted: false, reason: "not_foa_verified" }],
    [false, false, false, { admitted: false, reason: "not_foa_verified" }],
  ] as const)(
    "physical round %s, FOA-verified %s, physically ready %s",
    (judgesPhysical, foaVerified, physicallyReady, expected) => {
      expect(
        decidePoolAdmission({ judgesPhysical, foaVerified, physicallyReady })
      ).toEqual(expected);
    }
  );
});
