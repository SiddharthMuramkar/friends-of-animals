import { describe, expect, it } from "vitest";

import { parseBootstrapArgs } from "./bootstrap-super-admin-args";

describe("parseBootstrapArgs", () => {
  it("reads the email and the name", () => {
    expect(
      parseBootstrapArgs(["--email", "owner@example.test", "--name", "Owner"])
    ).toEqual({ ok: true, email: "owner@example.test", name: "Owner" });
  });

  it("names a new account FOA super admin when no name is given", () => {
    expect(parseBootstrapArgs(["--email=owner@example.test"])).toEqual({
      ok: true,
      email: "owner@example.test",
      name: "FOA super admin",
    });
  });

  it("needs a valid email", () => {
    for (const args of [[], ["--email", "not-an-email"], ["--name", "Owner"]]) {
      expect(parseBootstrapArgs(args)).toEqual({
        ok: false,
        error: expect.stringContaining("--email"),
      });
    }
  });

  it("refuses an option it doesn't know", () => {
    expect(
      parseBootstrapArgs(["--email", "owner@example.test", "--role", "judge"])
    ).toEqual({ ok: false, error: expect.stringContaining("--role") });
  });
});
