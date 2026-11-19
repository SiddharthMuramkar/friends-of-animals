import { afterEach, describe, expect, it, vi } from "vitest";

import robots from "./robots";

afterEach(() => {
  vi.unstubAllEnvs();
});

function robotsFor(appEnv: string) {
  vi.stubEnv("APP_ENV", appEnv);
  vi.stubEnv("APP_URL", "https://friendsofanimals.example");
  return robots();
}

function disallowed(result: ReturnType<typeof robots>): string[] {
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
  return rules.flatMap((rule) => rule.disallow ?? []);
}

describe("robots.txt", () => {
  it("links the sitemap in production", () => {
    expect(robotsFor("production").sitemap).toBe(
      "https://friendsofanimals.example/sitemap.xml"
    );
  });

  it.each(["staging", "preview", "local"])(
    "links no sitemap for APP_ENV=%s",
    (name) => {
      expect(robotsFor(name).sitemap).toBeUndefined();
    }
  );

  // A robots.txt block would stop crawlers from fetching pages, so they would
  // never see the X-Robots-Tag: noindex header that keeps them out of results.
  it.each(["production", "staging", "preview", "local"])(
    "lets crawlers fetch the public pages for APP_ENV=%s",
    (name) => {
      expect(disallowed(robotsFor(name))).not.toContain("/");
    }
  );

  it("keeps the private areas disallowed everywhere", () => {
    for (const name of ["production", "staging"]) {
      expect(disallowed(robotsFor(name))).toEqual(
        expect.arrayContaining(["/admin", "/dashboard", "/api"])
      );
    }
  });
});
