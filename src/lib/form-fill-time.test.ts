import { describe, expect, it } from "vitest";

import { fillWaitMs, MIN_FILL_MS } from "./form-fill-time";

describe("fillWaitMs", () => {
  it("waits out the rest of the bot screen's clock, with a little slack", () => {
    expect(fillWaitMs(1000, 1000)).toBe(3250);
    expect(fillWaitMs(1000, 3000)).toBe(1250);
  });

  it("doesn't wait once the clock and its slack have run", () => {
    expect(fillWaitMs(1000, 1000 + MIN_FILL_MS + 250)).toBe(0);
    expect(fillWaitMs(1000, 60_000)).toBe(0);
  });
});
