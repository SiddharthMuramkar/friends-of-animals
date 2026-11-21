import { describe, expect, it } from "vitest";

import {
  eligibleFinalists,
  planFinalistPool,
  type FinalistFacts,
  type PoolPlanFacts,
} from "./finalist-pool";

const facts = (overrides: Partial<FinalistFacts> = {}): FinalistFacts => ({
  sourceStatus: "locked",
  advancing: ["e3", "e1", "e2"],
  sourceJudgesPhysical: false,
  targetJudgesPhysical: false,
  ready: new Set(),
  ...overrides,
});

describe("eligibleFinalists()", () => {
  it("takes every advancing entry of a locked source when no round judges the artwork", () => {
    expect(eligibleFinalists(facts())).toEqual(["e1", "e2", "e3"]);
  });

  it.each(["draft", "open", "cancelled"] as const)(
    "takes nothing from a source that is %s",
    (sourceStatus) => {
      expect(eligibleFinalists(facts({ sourceStatus }))).toEqual([]);
    }
  );

  it.each([
    ["the next round", { targetJudgesPhysical: true }],
    ["the source round", { sourceJudgesPhysical: true }],
  ] as const)("needs the artwork ready when %s judges it", (_who, physical) => {
    const ready = new Set(["e2", "e9"]);
    expect(eligibleFinalists(facts({ ...physical, ready }))).toEqual(["e2"]);
  });

  it("takes each entry once", () => {
    expect(eligibleFinalists(facts({ advancing: ["e1", "e1"] }))).toEqual([
      "e1",
    ]);
  });
});

describe("planFinalistPool()", () => {
  const plan = (overrides: Partial<PoolPlanFacts> = {}) =>
    planFinalistPool({
      ...facts(),
      targetStatus: "draft",
      pool: [],
      ...overrides,
    });
  const unassigned = (entryId: string) => ({ entryId, assigned: false });
  const assigned = (entryId: string) => ({ entryId, assigned: true });

  it("adds every eligible finalist to an empty pool", () => {
    expect(plan()).toEqual({ add: ["e1", "e2", "e3"], remove: [], stale: [] });
  });

  it("changes nothing when the pool already matches", () => {
    const pool = [unassigned("e2"), assigned("e1"), unassigned("e3")];
    expect(plan({ pool })).toEqual({ add: [], remove: [], stale: [] });
  });

  it("removes an entry that stopped advancing while no judge has it", () => {
    const pool = [
      unassigned("e1"),
      unassigned("e2"),
      unassigned("e3"),
      unassigned("e4"),
    ];
    expect(plan({ pool })).toEqual({ add: [], remove: ["e4"], stale: [] });
  });

  it("keeps an entry that stopped advancing once a judge has it, as stale", () => {
    const pool = [unassigned("e1"), assigned("e4")];
    expect(plan({ pool })).toEqual({
      add: ["e2", "e3"],
      remove: [],
      stale: ["e4"],
    });
  });

  it("empties the unassigned pool while the source isn't locked", () => {
    // After switching to a source that hasn't locked yet.
    const pool = [unassigned("e1"), assigned("e2")];
    expect(plan({ sourceStatus: "open", pool })).toEqual({
      add: [],
      remove: ["e1"],
      stale: ["e2"],
    });
  });

  it("works in an open next round", () => {
    expect(plan({ targetStatus: "open" }).add).toEqual(["e1", "e2", "e3"]);
  });

  it.each(["locked", "cancelled"] as const)(
    "leaves a %s next round alone",
    (targetStatus) => {
      const pool = [unassigned("e4")];
      expect(plan({ targetStatus, pool })).toEqual({
        add: [],
        remove: [],
        stale: [],
      });
    }
  );
});
