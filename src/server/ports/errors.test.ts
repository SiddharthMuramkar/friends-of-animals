import { describe, expect, it } from "vitest";

import { hashUserId, silentErrorReporter } from "./errors";

describe("hashUserId", () => {
  it("is u_ and the first 32 hex digits of the id's SHA-256", () => {
    // Expected values from `printf '%s' <id> | sha256sum`.
    expect(hashUserId("0193a7b0-5c1e-7d2f-9a4b-8c6d2e1f3a5b")).toBe(
      "u_3751034121d475d5c662fe2ddc615d61"
    );
    expect(hashUserId("user-1")).toBe("u_c6c289e49e9c05b2145860387b73bcb1");
  });
});

describe("silentErrorReporter", () => {
  it("drops every report without throwing and has nothing left to send", async () => {
    expect(() =>
      silentErrorReporter.report(new Error("boom"), { where: "test" })
    ).not.toThrow();
    await expect(silentErrorReporter.flush(10)).resolves.toBe(true);
  });
});
