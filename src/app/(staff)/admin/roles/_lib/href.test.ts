import { describe, expect, it } from "vitest";

import { readRolesParams, rolesHref } from "./href";

const USER = "01938a00-0000-7000-8000-000000000101";

describe("rolesHref", () => {
  it("is the bare page with nothing to keep", () => {
    expect(rolesHref({})).toBe("/admin/roles");
  });

  it("names the chosen user by id only", () => {
    expect(rolesHref({ user: USER })).toBe(`/admin/roles?user=${USER}`);
  });

  it("never carries search text, which is personal data", () => {
    const params = { q: "asha@example.test", user: USER } as never;
    expect(rolesHref(params)).toBe(`/admin/roles?user=${USER}`);
  });

  it("adds what just happened, with a token so a repeat is announced", () => {
    expect(rolesHref({ user: USER, done: "granted", at: "k3x" })).toBe(
      `/admin/roles?user=${USER}&done=granted&at=k3x`
    );
  });
});

describe("readRolesParams", () => {
  it("reads the user and what happened, and ignores search text", () => {
    expect(
      readRolesParams({ q: "asha", user: USER, done: "revoked", at: "k3x" })
    ).toEqual({ user: USER, done: "revoked", at: "k3x" });
  });

  it("takes the first of repeated params and drops unknown outcomes", () => {
    expect(
      readRolesParams({ user: [USER, "x"], done: "deleted", at: [] })
    ).toEqual({ user: USER });
  });

  it("round-trips through rolesHref", () => {
    const params = {
      user: USER,
      done: "unchanged",
      at: "1",
    } as const;
    const url = new URL(rolesHref(params), "https://example.test");
    expect(readRolesParams(Object.fromEntries(url.searchParams))).toEqual(
      params
    );
  });
});
