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

  it("says every fee is paid once no enrolled student is waiting", () => {
    expect(feeSummary({ enrolled: 0, confirmed: 30, withdrawn: 1 })).toEqual({
      kind: "paid",
      confirmed: 30,
    });
  });

  it("says nothing about fees before any student is enrolled", () => {
    expect(feeSummary({ enrolled: 0, confirmed: 0, withdrawn: 3 })).toEqual({
      kind: "none",
    });
  });
});
