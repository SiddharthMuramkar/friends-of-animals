import { describe, expect, it } from "vitest";

import { DURATION_TOLERANCE_MS, isOverDuration } from "./video-duration";

describe("isOverDuration", () => {
  const limit = 180_000;

  it("allows a clip up to the limit plus a second of slack", () => {
    expect(DURATION_TOLERANCE_MS).toBe(1_000);
    expect(isOverDuration(180_000, limit)).toBe(false);
    expect(isOverDuration(181_000, limit)).toBe(false);
  });

  it("refuses anything longer", () => {
    expect(isOverDuration(181_001, limit)).toBe(true);
  });

  it("can't refuse a clip whose length is unknown", () => {
    expect(isOverDuration(null, limit)).toBe(false);
  });
});
