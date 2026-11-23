import { describe, expect, it } from "vitest";

import { checkoutReturnFrom } from "./pay-view";

// What Checkout hands back reaches a confirm action as an argument anyone
// can post, so the action checks its shape before using it.
describe("what Checkout hands back", () => {
  it("is taken when it has a payment id and a signature", () => {
    expect(
      checkoutReturnFrom({ paymentId: "pay_1", signature: "sig", extra: 1 })
    ).toEqual({ paymentId: "pay_1", signature: "sig" });
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "pay_1"],
    ["no signature", { paymentId: "pay_1" }],
    ["a number for the payment id", { paymentId: 1, signature: "sig" }],
  ])("is refused when it is %s", (_label, value) => {
    expect(checkoutReturnFrom(value)).toBeNull();
  });
});
