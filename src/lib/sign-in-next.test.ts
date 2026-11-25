import { describe, expect, it } from "vitest";
import { signInNext } from "./sign-in-next";

describe("sign-in return paths", () => {
  it("accepts only exact local auction lots and existing judge invitations", () => {
    expect(signInNext("/auctions/LOT-27-5EED1")).toBe("/auctions/LOT-27-5EED1");
    expect(signInNext(`/judge/invitations/${"x".repeat(43)}`)).toBe(
      `/judge/invitations/${"x".repeat(43)}`
    );
    for (const invalid of [
      "https://example.test/auctions/LOT-27-5EED1",
      "//example.test/auctions/LOT-27-5EED1",
      "/auctions/LOT-27-5EED1?next=//example.test",
      "/auctions/LOT-27-5EED1#x",
      "/auctions/../admin",
      "/admin",
    ])
      expect(signInNext(invalid)).toBeNull();
  });
});
