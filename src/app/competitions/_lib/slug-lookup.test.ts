import { describe, expect, it } from "vitest";

import { memoisedSlugLookup } from "./slug-lookup";

/** A lookup over `slugs` (mutable), counting loads, on a hand-moved clock. */
function setup(initial: string[] = ["kinder-skies"]) {
  const state = { slugs: [...initial], loads: 0, now: 1_000_000 };
  const lookup = memoisedSlugLookup({
    load: async () => {
      state.loads += 1;
      return [...state.slugs];
    },
    now: () => state.now,
    ttlMs: 60_000,
    missRefreshMs: 1_000,
  });
  return { state, lookup };
}

describe("memoisedSlugLookup", () => {
  it("loads the published slugs once and answers repeat visits from memory", async () => {
    const { state, lookup } = setup();
    expect(await lookup("kinder-skies")).toBe(true);
    state.now += 59_000;
    expect(await lookup("kinder-skies")).toBe(true);
    expect(state.loads).toBe(1);
  });

  it("reloads on a miss, so a competition published since shows at once", async () => {
    const { state, lookup } = setup();
    expect(await lookup("a-bowl-of-water")).toBe(false);
    state.slugs.push("a-bowl-of-water");
    state.now += 1_000;
    expect(await lookup("a-bowl-of-water")).toBe(true);
    expect(state.loads).toBe(2);
  });

  it("reloads at most once a second for unknown slugs", async () => {
    const { state, lookup } = setup();
    for (const slug of ["nope-1", "nope-2", "nope-3"]) {
      expect(await lookup(slug)).toBe(false);
    }
    state.now += 999;
    expect(await lookup("nope-4")).toBe(false);
    expect(state.loads).toBe(1);
  });

  it("reloads a known slug once the memory is a minute old", async () => {
    const { state, lookup } = setup();
    await lookup("kinder-skies");
    state.now += 60_000;
    await lookup("kinder-skies");
    expect(state.loads).toBe(2);
  });

  it("shares one load between requests that arrive together", async () => {
    const { state, lookup } = setup();
    const answers = await Promise.all([
      lookup("kinder-skies"),
      lookup("kinder-skies"),
      lookup("nope"),
    ]);
    expect(answers).toEqual([true, true, false]);
    expect(state.loads).toBe(1);
  });

  it("rejects when the load fails, and tries again on the next request", async () => {
    let fail = true;
    let loads = 0;
    const lookup = memoisedSlugLookup({
      load: async () => {
        loads += 1;
        if (fail) throw new Error("database unavailable");
        return ["kinder-skies"];
      },
      now: () => 0,
      ttlMs: 60_000,
      missRefreshMs: 1_000,
    });
    await expect(lookup("kinder-skies")).rejects.toThrow(
      "database unavailable"
    );
    fail = false;
    expect(await lookup("kinder-skies")).toBe(true);
    expect(loads).toBe(2);
  });
});
