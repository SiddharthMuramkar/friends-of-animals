// Which entries flow from a round into the next one (#98). A round fed by
// another round's finalists takes the entries that advance from it
// (winners, runners-up and finalists, as its outcomes are tagged), once
// it is locked and never before. When either round judges the physical
// artwork, an entry also needs its artwork physically ready for judging
// right now.
//
// Pure: the caller loads the facts set-wise and writes the plan in the
// same transaction as whatever changed them (a lock, an outcome save, a
// new source).
//
// Loads under plain Node: relative imports only.

import type { ChainRoundStatus } from "./chain";

export type FinalistFacts = {
  sourceStatus: ChainRoundStatus;
  /** Entries whose locked result in the source round advances. */
  advancing: readonly string[];
  sourceJudgesPhysical: boolean;
  targetJudgesPhysical: boolean;
  /** Entries whose artwork is physically ready for judging now. */
  ready: ReadonlySet<string>;
};

/** The source's finalists the next round may take now, sorted. */
export function eligibleFinalists(facts: FinalistFacts): string[] {
  if (facts.sourceStatus !== "locked") return [];
  const needsReady = facts.sourceJudgesPhysical || facts.targetJudgesPhysical;
  const eligible = facts.advancing.filter(
    (entryId) => !needsReady || facts.ready.has(entryId)
  );
  return [...new Set(eligible)].sort();
}

export type PoolPlanFacts = FinalistFacts & {
  targetStatus: ChainRoundStatus;
  /** The next round's pool now, and whether a judge has each entry. */
  pool: readonly { entryId: string; assigned: boolean }[];
};

export type FinalistPoolPlan = {
  /** Eligible finalists not yet in the pool. */
  add: string[];
  /** Pool entries that no longer qualify and no judge has. */
  remove: string[];
  /**
   * Pool entries that no longer qualify but stay, because a judge has
   * them (default to confirm with FOA, HR-40). The levels page flags them.
   */
  stale: string[];
};

/**
 * How to bring the next round's pool in line with its source's finalists.
 * Only a draft or open round's pool changes; a locked or cancelled one is
 * left as it is.
 */
export function planFinalistPool(facts: PoolPlanFacts): FinalistPoolPlan {
  if (facts.targetStatus !== "draft" && facts.targetStatus !== "open") {
    return { add: [], remove: [], stale: [] };
  }
  const eligible = eligibleFinalists(facts);
  const qualifies = new Set(eligible);
  const inPool = new Set(facts.pool.map(({ entryId }) => entryId));
  const leaving = facts.pool.filter(({ entryId }) => !qualifies.has(entryId));
  return {
    add: eligible.filter((entryId) => !inPool.has(entryId)),
    remove: idsOf(leaving.filter(({ assigned }) => !assigned)),
    stale: idsOf(leaving.filter(({ assigned }) => assigned)),
  };
}

function idsOf(pool: readonly { entryId: string }[]): string[] {
  return pool.map(({ entryId }) => entryId).sort();
}
