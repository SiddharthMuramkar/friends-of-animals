import { describe, expect, it } from "vitest";

import {
  linesHash,
  releaseContentHash,
  snapshotLines,
  type RoundAwardLine,
  type SnapshotLine,
} from "./snapshot";

const RANKED = ["first", "second", "third"] as const;
const GRADES = ["grade_a", "grade_b"] as const;

function line(over: Partial<RoundAwardLine> = {}): RoundAwardLine {
  return {
    entryId: "e-1",
    entryCode: "NEIGH27-0001",
    participantProfileId: "p-1",
    discipline: "drawing",
    ageGroup: "8-10",
    outcome: "winner",
    awardPosition: 1,
    ...over,
  };
}

const ROUND: RoundAwardLine[] = [
  line({
    entryId: "e-5",
    entryCode: "NEIGH27-0005",
    discipline: "painting",
    outcome: "finalist",
    awardPosition: null,
  }),
  line({
    entryId: "e-2",
    entryCode: "NEIGH27-0002",
    outcome: "runner_up",
    awardPosition: 2,
  }),
  line({
    entryId: "e-9",
    entryCode: "NEIGH27-0009",
    outcome: "none",
    awardPosition: null,
  }),
  line({
    entryId: "e-4",
    entryCode: "NEIGH27-0004",
    outcome: "special_mention",
    awardPosition: null,
  }),
  line({ entryId: "e-1", entryCode: "NEIGH27-0001" }),
  line({
    entryId: "e-3",
    entryCode: "NEIGH27-0003",
    outcome: "finalist",
    awardPosition: null,
  }),
  line({
    entryId: "e-6",
    entryCode: "NEIGH27-0006",
    ageGroup: "11-13",
    outcome: "runner_up",
    awardPosition: 3,
  }),
];

describe("snapshotLines", () => {
  it("keeps every award line, drops entries with no outcome, and sorts them", () => {
    const lines = snapshotLines(ROUND, RANKED);
    expect(lines.map((l) => l.entryCode)).toEqual([
      // drawing 11-13
      "NEIGH27-0006",
      // drawing 8-10: positions first, then finalists, then special mentions
      "NEIGH27-0001",
      "NEIGH27-0002",
      "NEIGH27-0003",
      "NEIGH27-0004",
      // painting 8-10
      "NEIGH27-0005",
    ]);
  });

  it("gives placed winners and runners-up the scheme's band for their position", () => {
    const bands = Object.fromEntries(
      snapshotLines(ROUND, RANKED).map((l) => [l.entryCode, l.awardBand])
    );
    expect(bands).toEqual({
      "NEIGH27-0001": "first",
      "NEIGH27-0002": "second",
      "NEIGH27-0006": "third",
      "NEIGH27-0003": null,
      "NEIGH27-0004": null,
      "NEIGH27-0005": null,
    });
  });

  it("leaves a position the scheme has no band for without one", () => {
    const bands = Object.fromEntries(
      snapshotLines(ROUND, GRADES).map((l) => [l.entryCode, l.awardBand])
    );
    expect(bands["NEIGH27-0001"]).toBe("grade_a");
    expect(bands["NEIGH27-0002"]).toBe("grade_b");
    expect(bands["NEIGH27-0006"]).toBeNull();
  });

  it("gives no band to a finalist or special mention that carries a position", () => {
    const [only] = snapshotLines(
      [line({ outcome: "special_mention", awardPosition: 1 })],
      RANKED
    );
    expect(only?.awardBand).toBeNull();
  });

  it("orders the same input the same way whatever order it arrives in", () => {
    const reversed = [...ROUND].reverse();
    expect(snapshotLines(reversed, RANKED)).toEqual(
      snapshotLines(ROUND, RANKED)
    );
  });

  it("refuses an entry that appears twice", () => {
    expect(() => snapshotLines([line(), line()], RANKED)).toThrow(
      /e-1.*more than once/
    );
  });
});

describe("linesHash", () => {
  const lines = snapshotLines(ROUND, RANKED);

  it("is a sha256 hex digest", () => {
    expect(linesHash(lines)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for the same lines and ignores key order", () => {
    const shuffledKeys = lines.map((l): SnapshotLine => ({
      awardBand: l.awardBand,
      awardPosition: l.awardPosition,
      outcome: l.outcome,
      ageGroup: l.ageGroup,
      discipline: l.discipline,
      participantProfileId: l.participantProfileId,
      entryCode: l.entryCode,
      entryId: l.entryId,
    }));
    expect(linesHash(shuffledKeys)).toBe(linesHash(lines));
  });

  it("changes when any line changes", () => {
    const retagged = lines.map((l) =>
      l.entryCode === "NEIGH27-0003" ? { ...l, outcome: "winner" as const } : l
    );
    expect(linesHash(retagged)).not.toBe(linesHash(lines));
  });
});

describe("releaseContentHash", () => {
  const content = {
    competitionId: "c-1",
    sourceRoundId: "r-1",
    publishAt: new Date("2027-03-01T04:30:00.000Z"),
    deliveryNote: "Trophies are posted to your school by 30 March.",
    lines: snapshotLines(ROUND, RANKED),
  };

  it("is stable for the same content", () => {
    expect(releaseContentHash({ ...content })).toBe(
      releaseContentHash(content)
    );
    expect(releaseContentHash(content)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("covers the publish time, the delivery note and the lines", () => {
    const base = releaseContentHash(content);
    expect(
      releaseContentHash({
        ...content,
        publishAt: new Date("2027-03-01T04:30:01.000Z"),
      })
    ).not.toBe(base);
    expect(releaseContentHash({ ...content, publishAt: null })).not.toBe(base);
    expect(
      releaseContentHash({ ...content, deliveryNote: "Collect at FOA." })
    ).not.toBe(base);
    expect(releaseContentHash({ ...content, deliveryNote: null })).not.toBe(
      base
    );
    expect(
      releaseContentHash({ ...content, lines: content.lines.slice(1) })
    ).not.toBe(base);
    expect(releaseContentHash({ ...content, sourceRoundId: "r-2" })).not.toBe(
      base
    );
  });
});
