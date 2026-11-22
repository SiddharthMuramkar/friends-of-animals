import { describe, expect, it } from "vitest";

import { isTeenAcceptError } from "./teen-accept-error";

describe("isTeenAcceptError", () => {
  it("knows the reasons a teen's accept is refused, and nothing else", () => {
    expect(isTeenAcceptError("contact_mismatch")).toBe(true);
    expect(isTeenAcceptError("guardian_cannot_accept")).toBe(true);
    expect(isTeenAcceptError("accepter_is_guardian")).toBe(true);
    expect(isTeenAcceptError("accepter_is_adult")).toBe(true);
    expect(isTeenAcceptError("identifier_mismatch")).toBe(false);
    expect(isTeenAcceptError(["expired"])).toBe(false);
  });
});
