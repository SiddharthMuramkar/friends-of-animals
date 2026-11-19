import { describe, expect, it } from "vitest";

import { isIndexable, robotsHeaders } from "./indexing";

const NON_PRODUCTION = ["staging", "preview", "local"];

describe("isIndexable()", () => {
  it("lets search engines index production", () => {
    expect(isIndexable({ APP_ENV: "production" })).toBe(true);
  });

  it.each(NON_PRODUCTION)("keeps APP_ENV=%s out of search engines", (name) => {
    expect(isIndexable({ APP_ENV: name })).toBe(false);
  });

  it("keeps an unset or unknown APP_ENV out of search engines", () => {
    expect(isIndexable({})).toBe(false);
    expect(isIndexable({ APP_ENV: "prod" })).toBe(false);
  });

  it("reads APP_ENV, never VERCEL_ENV", () => {
    expect(isIndexable({ APP_ENV: "staging", VERCEL_ENV: "production" })).toBe(
      false
    );
    expect(isIndexable({ APP_ENV: "production", VERCEL_ENV: "preview" })).toBe(
      true
    );
  });
});

describe("robotsHeaders()", () => {
  it("adds no X-Robots-Tag in production", () => {
    expect(robotsHeaders({ APP_ENV: "production" })).toEqual([]);
  });

  it.each(NON_PRODUCTION)(
    "sends X-Robots-Tag: noindex, nofollow on every path for APP_ENV=%s",
    (name) => {
      expect(robotsHeaders({ APP_ENV: name })).toEqual([
        {
          source: "/:path*",
          headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
        },
      ]);
    }
  );
});
