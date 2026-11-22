import { describe, expect, it } from "vitest";

import { isAcceptError } from "./accept-error";

describe("isAcceptError", () => {
  it("accepts only reasons acceptInvitation returns", () => {
    expect(isAcceptError("expired")).toBe(true);
    expect(isAcceptError("identifier_mismatch")).toBe(true);
    expect(isAcceptError("forbidden")).toBe(false);
    expect(isAcceptError(["expired"])).toBe(false);
    expect(isAcceptError(undefined)).toBe(false);
  });
});
