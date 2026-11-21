import { describe, expect, it } from "vitest";

import { createSlugGate } from "./slug-gate";

const TTL = 60_000;

/** A gate over a slug source the test controls, on a hand-moved clock. */
function world(initial: string[]) {
  let slugs = initial;
  let loads = 0;
  let failing = false;
  let now = 0;
  const gate = createSlugGate({
    ttlMs: TTL,
    now: () => now,
    load: async () => {
      loads += 1;
      if (failing) throw new Error("database unreachable");
      return slugs;
    },
  });
  return {
    gate,
    loads: () => loads,
    publish: (next: string[]) => (slugs = next),
    fail: (on: boolean) => (failing = on),
    advance: (ms: number) => (now += ms),
  };
}

describe("the proxy's published-slug gate", () => {
  it("knows published slugs and nothing else", async () => {
    const w = world(["kinder-skies-in-kite-season"]);
    expect(await w.gate.has("kinder-skies-in-kite-season")).toBe(true);
    expect(await w.gate.has("a-draft-post")).toBe(false);
  });

  it("reads the slugs once for many requests, not once per request", async () => {
    const w = world(["kinder-skies-in-kite-season"]);
    await Promise.all(
      Array.from({ length: 20 }, () =>
        w.gate.has("kinder-skies-in-kite-season")
      )
    );
    w.advance(TTL - 1);
    await w.gate.has("other");
    expect(w.loads()).toBe(1);
  });

  it("sees a post published since, once the minute is up", async () => {
    const w = world(["kinder-skies-in-kite-season"]);
    expect(await w.gate.has("new-post")).toBe(false);
    w.publish(["kinder-skies-in-kite-season", "new-post"]);
    w.advance(TTL);
    expect(await w.gate.has("new-post")).toBe(true);
    expect(w.loads()).toBe(2);
  });

  it("keeps the last slugs it read while the source fails", async () => {
    const w = world(["kinder-skies-in-kite-season"]);
    await w.gate.has("kinder-skies-in-kite-season");
    w.fail(true);
    w.advance(TTL);
    expect(await w.gate.has("kinder-skies-in-kite-season")).toBe(true);
    expect(await w.gate.has("a-draft-post")).toBe(false);
  });

  it("lets every slug through when it has never read any, and retries after a minute", async () => {
    const w = world(["kinder-skies-in-kite-season"]);
    w.fail(true);
    // The page still renders its own not-found for a slug that isn't public.
    expect(await w.gate.has("anything")).toBe(true);
    expect(await w.gate.has("anything-else")).toBe(true);
    expect(w.loads()).toBe(1);
    w.fail(false);
    w.advance(TTL);
    expect(await w.gate.has("anything")).toBe(false);
  });
});
