import { describe, expect, it } from "vitest";

import {
  decideScoringAccess,
  type ScoringFacts,
  type ScoringIntent,
} from "./scoring-access";

const ready: ScoringFacts = {
  roundStatus: "open",
  onboarded: true,
  assigned: true,
};

describe("decideScoringAccess", () => {
  it.each<[string, Partial<ScoringFacts>, ScoringIntent, string]>([
    ["assigned judge reads an open round", {}, "read", "ok"],
    ["assigned judge scores an open round", {}, "write", "ok"],
    [
      "assigned judge reads a locked round",
      { roundStatus: "locked" },
      "read",
      "ok",
    ],
    [
      "assigned judge scores a locked round",
      { roundStatus: "locked" },
      "write",
      "round_locked",
    ],
    ["unassigned judge reads", { assigned: false }, "read", "entry_not_found"],
    [
      "unassigned judge scores",
      { assigned: false },
      "write",
      "entry_not_found",
    ],
    [
      "judge of no such round",
      { roundStatus: null, assigned: false },
      "read",
      "entry_not_found",
    ],
    [
      "round still in draft",
      { roundStatus: "draft" },
      "read",
      "entry_not_found",
    ],
    [
      "cancelled round",
      { roundStatus: "cancelled" },
      "write",
      "entry_not_found",
    ],
    ["judge before onboarding", { onboarded: false }, "read", "not_onboarded"],
    [
      "judge before onboarding scores",
      { onboarded: false },
      "write",
      "not_onboarded",
    ],
    // Unassigned and not onboarded: say nothing about the entry.
    [
      "unassigned judge before onboarding",
      { onboarded: false, assigned: false },
      "read",
      "not_onboarded",
    ],
    [
      "unassigned judge of a locked round",
      { roundStatus: "locked", assigned: false },
      "write",
      "entry_not_found",
    ],
  ])("%s: %s", (_name, facts, intent, expected) => {
    const decision = decideScoringAccess({ ...ready, ...facts }, intent);
    expect(decision.ok ? "ok" : decision.code).toBe(expected);
  });

  it("gives a missing, an unassigned and a hidden entry the same answer", () => {
    const answers = [
      decideScoringAccess(
        { roundStatus: null, onboarded: true, assigned: false },
        "read"
      ),
      decideScoringAccess({ ...ready, assigned: false }, "read"),
      decideScoringAccess({ ...ready, roundStatus: "draft" }, "read"),
    ];
    expect(new Set(answers.map((answer) => JSON.stringify(answer)))).toEqual(
      new Set([JSON.stringify({ ok: false, code: "entry_not_found" })])
    );
  });
});
