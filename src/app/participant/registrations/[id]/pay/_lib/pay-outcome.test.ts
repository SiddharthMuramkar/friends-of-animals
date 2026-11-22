import { describe, expect, it } from "vitest";

import { isPayOutcome, payOutcome } from "./pay-outcome";

describe("payOutcome", () => {
  it("says a free or already paid registration is confirmed", () => {
    expect(
      payOutcome({
        ok: true,
        kind: "confirmed_free",
        registrationNumber: "NEIGH27-R-7K3M9Q",
      })
    ).toBe("confirmed");
    expect(
      payOutcome({
        ok: true,
        kind: "confirmed",
        registrationNumber: "NEIGH27-R-7K3M9Q",
      })
    ).toBe("confirmed");
  });

  it("names each refusal", () => {
    expect(payOutcome({ ok: false, error: "gateway_unavailable" })).toBe(
      "gateway_unavailable"
    );
  });

  it("reads only outcomes it knows from the address", () => {
    expect(isPayOutcome("checkout")).toBe(true);
    expect(isPayOutcome("javascript:alert(1)")).toBe(false);
    expect(isPayOutcome(["checkout"])).toBe(false);
  });
});
