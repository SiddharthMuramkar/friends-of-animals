import { describe, expect, it } from "vitest";

import { shouldSkipPrefetch } from "./connection";

describe("shouldSkipPrefetch", () => {
  it("prefetches when the browser doesn't expose the connection", () => {
    expect(shouldSkipPrefetch(undefined)).toBe(false);
    expect(shouldSkipPrefetch(null)).toBe(false);
    expect(shouldSkipPrefetch({})).toBe(false);
  });

  it("skips prefetching when data saver is on, whatever the speed", () => {
    expect(shouldSkipPrefetch({ saveData: true })).toBe(true);
    expect(shouldSkipPrefetch({ saveData: true, effectiveType: "4g" })).toBe(
      true
    );
  });

  it("skips prefetching on 2G-slow connections", () => {
    expect(shouldSkipPrefetch({ effectiveType: "2g" })).toBe(true);
    expect(shouldSkipPrefetch({ effectiveType: "slow-2g" })).toBe(true);
  });

  it("prefetches on 3G and 4G without data saver", () => {
    expect(shouldSkipPrefetch({ saveData: false, effectiveType: "3g" })).toBe(
      false
    );
    expect(shouldSkipPrefetch({ saveData: false, effectiveType: "4g" })).toBe(
      false
    );
  });
});
