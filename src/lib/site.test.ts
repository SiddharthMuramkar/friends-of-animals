import { describe, expect, it } from "vitest";

import {
  appEnv,
  assertNoPlaceholdersInProduction,
  findPlaceholders,
  isPlaceholder,
  isSampleContentEnabled,
  placeholder,
  SITE,
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
    expect(findPlaceholders(SITE.org)).toContain("legalName");
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

describe("assertNoPlaceholdersInProduction()", () => {
  const withPlaceholder = { email: placeholder("email"), name: "FOA" };

  it("fails a production build while placeholders remain", () => {
    expect(() =>
      assertNoPlaceholdersInProduction(
        { APP_ENV: "production" },
        withPlaceholder
      )
    ).toThrow(/email/);
  });

  it("fails production with the real SITE.org today", () => {
    expect(() =>
      assertNoPlaceholdersInProduction({ APP_ENV: "production" })
    ).toThrow(/placeholder/i);
  });

  it("lets staging and local builds through", () => {
    expect(() =>
      assertNoPlaceholdersInProduction({ APP_ENV: "staging" }, withPlaceholder)
    ).not.toThrow();
    expect(() => assertNoPlaceholdersInProduction({})).not.toThrow();
  });

  it("passes production once every fact is confirmed", () => {
    expect(() =>
      assertNoPlaceholdersInProduction({ APP_ENV: "production" }, { a: "x" })
    ).not.toThrow();
  });
});
