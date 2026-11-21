import { describe, expect, it } from "vitest";

import { feeSummary } from "./fee-summary";

describe("feeSummary", () => {
  it("offers Pay fees while some students are not paid for, with both counts", () => {
    expect(feeSummary({ enrolled: 18, confirmed: 12, withdrawn: 2 })).toEqual({
      kind: "unpaid",
      unpaid: 18,
      confirmed: 12,
    });
  });
});
