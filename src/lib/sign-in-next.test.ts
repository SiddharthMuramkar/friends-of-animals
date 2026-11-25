import { describe, expect, it } from "vitest";
import { signInNext } from "./sign-in-next";

describe("sign-in return paths", () => {
  it("accepts only recognised event, auction and judge-invitation paths", () => {
    expect(signInNext("/events/compassion-workshop")).toBe(
      "/events/compassion-workshop"
    );
    expect(signInNext("/account/auctions")).toBe("/account/auctions");
    expect(signInNext("/account/auctions/LOT-27-5EED5")).toBe(
      "/account/auctions/LOT-27-5EED5"
    );
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
      "/events/safe-title?next=//example.test",
      "/events/../admin",
      "/events/UPPER-case",
      "//elsewhere.test/events/safe-title",
      "/account/auctions/LOT-27-5EED5?next=//example.test",
      "/account/auctions/../admin",
    ])
      expect(signInNext(invalid)).toBeNull();
  });
});
