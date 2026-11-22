import { describe, expect, it } from "vitest";

import {
  appEnv,
  findPlaceholders,
  isPlaceholder,
  isSampleContentEnabled,
  placeholder,
  SITE,
  unconfirmedFactsWarning,
} from "./site";

describe("placeholder()", () => {
  it("marks a value as not yet confirmed", () => {
    expect(isPlaceholder(placeholder("email"))).toBe(true);
    expect(isPlaceholder("hello@foa.org")).toBe(false);
    expect(isPlaceholder(undefined)).toBe(false);
  });
});

describe("findPlaceholders()", () => {
  it("lists the path of every placeholder, however deep", () => {
    const tree = {
      name: "FOA",
      email: placeholder("email"),
      fees: {
        school: placeholder("feeSchool"),
        list: [placeholder("socials")],
      },
    };
    expect(findPlaceholders(tree)).toEqual([
      "email",
      "fees.school",
      "fees.list.0",
    ]);
  });

  it("finds the org facts FOA has not confirmed yet", () => {
    expect(findPlaceholders(SITE.org)).toContain("fees.school");
  });
});

describe("appEnv() and samples", () => {
  it("defaults to local and shows samples outside production", () => {
    expect(appEnv({})).toBe("local");
    expect(appEnv({ APP_ENV: "staging" })).toBe("staging");
    expect(isSampleContentEnabled({ APP_ENV: "staging" })).toBe(true);
    expect(isSampleContentEnabled({})).toBe(true);
    expect(isSampleContentEnabled({ APP_ENV: "production" })).toBe(false);
  });

  it("treats an unknown APP_ENV as local", () => {
    expect(appEnv({ APP_ENV: "prod" })).toBe("local");
  });
});

// Owner's decision of 2026-11-21: production ships without the facts FOA
// hasn't confirmed, so the build names them instead of failing.
describe("unconfirmedFactsWarning()", () => {
  const withPlaceholders = {
    email: placeholder("email"),
    name: "FOA",
    fees: { school: placeholder("feeSchool") },
  };

  it("names each unconfirmed fact in one line for a production build", () => {
    expect(
      unconfirmedFactsWarning({ APP_ENV: "production" }, withPlaceholders)
    ).toBe(
      "Warning: production leaves out the organisation facts FOA hasn't confirmed yet (SITE.org in src/lib/site.ts): email, fees.school"
    );
  });

  // FOA's contact, registration and grievance facts live in the database
  // (getOrgFacts, checked by /api/health); only the fees stay in code.
  it("names the real SITE.org's unconfirmed facts by dotted path today", () => {
    const line = unconfirmedFactsWarning({ APP_ENV: "production" });
    expect(line).toContain("fees.school");
    expect(line).toContain("fees.individual");
    expect(line).not.toContain("legalName");
    expect(line).not.toContain("\n");
  });

  it("says nothing for local, preview and staging builds", () => {
    for (const env of [{}, { APP_ENV: "preview" }, { APP_ENV: "staging" }]) {
      expect(unconfirmedFactsWarning(env, withPlaceholders)).toBeUndefined();
    }
    expect(unconfirmedFactsWarning({})).toBeUndefined();
  });

  it("says nothing once every fact is confirmed", () => {
    expect(
      unconfirmedFactsWarning({ APP_ENV: "production" }, { a: "x" })
    ).toBeUndefined();
  });
});
