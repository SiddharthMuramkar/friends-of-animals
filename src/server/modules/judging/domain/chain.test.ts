import { describe, expect, it } from "vitest";

import {
  chainOrder,
  finalRoundIds,
  sourceProblem,
  type ChainRound,
} from "./chain";

const round = (
  id: string,
  sourceRoundId: string | null = null,
  overrides: Partial<ChainRound> = {}
): ChainRound => ({
  id,
  competitionId: "c1",
  status: "draft",
  sourceRoundId,
  ...overrides,
});

describe("sourceProblem()", () => {
  it("refuses a round as its own source", () => {
    expect(sourceProblem([round("a")], "a", "a")).toBe("source_is_self");
  });

  it("refuses a source that would close a loop", () => {
    // a feeds b, b feeds c; making c feed a closes the loop.
    const rounds = [round("a"), round("b", "a"), round("c", "b")];
    expect(sourceProblem(rounds, "a", "c")).toBe("chain_cycle");
    expect(sourceProblem(rounds, "b", "c")).toBe("chain_cycle");
  });

  it.each(["open", "locked", "cancelled"] as const)(
    "refuses to re-source a round that is %s",
    (status) => {
      const rounds = [round("a"), round("b", null, { status })];
      expect(sourceProblem(rounds, "b", "a")).toBe("round_not_editable");
    }
  );

  it("refuses a missing source and one in another competition alike", () => {
    const rounds = [round("a", null, { competitionId: "c2" }), round("b")];
    expect(sourceProblem(rounds, "b", "a")).toBe("source_not_found");
    expect(sourceProblem(rounds, "b", "zz")).toBe("source_not_found");
  });

  it("refuses a cancelled source, and takes a draft, open or locked one", () => {
    const withSource = (status: ChainRound["status"]) =>
      sourceProblem([round("a", null, { status }), round("b")], "b", "a");
    expect(withSource("cancelled")).toBe("source_cancelled");
    expect(withSource("draft")).toBeNull();
    expect(withSource("open")).toBeNull();
    expect(withSource("locked")).toBeNull();
  });

  it("checks the round before the source", () => {
    const rounds = [
      round("a", null, { status: "cancelled" }),
      round("b", null, { status: "open" }),
    ];
    expect(sourceProblem(rounds, "b", "b")).toBe("round_not_editable");
    expect(sourceProblem(rounds, "b", "a")).toBe("round_not_editable");
  });

  it("allows a source further up or in another branch", () => {
    // a feeds b and d; b feeds c.
    const rounds = [
      round("a"),
      round("b", "a"),
      round("c", "b"),
      round("d", "a"),
    ];
    expect(sourceProblem(rounds, "c", "a")).toBeNull();
    expect(sourceProblem(rounds, "d", "c")).toBeNull();
    expect(sourceProblem(rounds, "c", "d")).toBeNull();
  });
});

describe("finalRoundIds()", () => {
  it("names the live rounds no live round takes finalists from", () => {
    // a feeds b and d, b feeds c; d is cancelled; e stands alone.
    const rounds = [
      round("a", null, { status: "locked" }),
      round("b", "a", { status: "open" }),
      round("c", "b"),
      round("d", "a", { status: "cancelled" }),
      round("e", null, { status: "open" }),
    ];
    expect(finalRoundIds(rounds)).toEqual(["c", "e"]);
  });

  it("makes the source final again when the round after it is cancelled", () => {
    const rounds = [
      round("a", null, { status: "locked" }),
      round("b", "a", { status: "cancelled" }),
    ];
    expect(finalRoundIds(rounds)).toEqual(["a"]);
  });
});

describe("chainOrder()", () => {
  it("lists each chain from its first round down, branches in the given order", () => {
    const rounds = [
      round("national", "state"),
      round("other"),
      round("state", "city"),
      round("city"),
      round("exhibition", "city"),
    ];
    expect(chainOrder(rounds)).toEqual([
      { round: rounds[1], depth: 0 },
      { round: rounds[3], depth: 0 },
      { round: rounds[2], depth: 1 },
      { round: rounds[0], depth: 2 },
      { round: rounds[4], depth: 1 },
    ]);
  });

  it("starts a chain at a round whose source isn't listed", () => {
    const rounds = [round("b", "gone")];
    expect(chainOrder(rounds)).toEqual([{ round: rounds[0], depth: 0 }]);
  });

  it("still lists every round if the data already holds a loop", () => {
    const rounds = [round("a", "b"), round("b", "a")];
    expect(chainOrder(rounds).map(({ round }) => round.id)).toEqual(["a", "b"]);
  });
});
