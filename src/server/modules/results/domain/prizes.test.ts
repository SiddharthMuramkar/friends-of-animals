import { describe, expect, it } from "vitest";

import { prizeAwards } from "./prizes";
import type { SnapshotLine } from "./snapshot";

function line(over: Partial<SnapshotLine>): SnapshotLine {
  return {
    entryId: "e-1",
    entryCode: "NEIGH27-0001",
    participantProfileId: "p-1",
    discipline: "drawing",
    ageGroup: "8-10",
    outcome: "winner",
    awardPosition: 1,
    awardBand: "first",
    ...over,
  };
}

const LINES: SnapshotLine[] = [
  line({}),
  line({
    entryId: "e-2",
    participantProfileId: "p-2",
    outcome: "runner_up",
    awardPosition: 2,
    awardBand: "second",
  }),
  line({
    entryId: "e-3",
    participantProfileId: "p-3",
    outcome: "runner_up",
    awardPosition: 3,
    awardBand: "third",
  }),
  line({
    entryId: "e-4",
    participantProfileId: "p-4",
    outcome: "finalist",
    awardPosition: null,
    awardBand: null,
  }),
  line({
    entryId: "e-5",
    participantProfileId: "p-5",
    outcome: "special_mention",
    awardPosition: null,
    awardBand: null,
  }),
];

describe("prizeAwards", () => {
  it("gives one award per banded line, in snapshot order, with the band's prize text", () => {
    expect(
      prizeAwards(LINES, { first: "Trophy and certificate", second: "Medal" })
    ).toEqual([
      {
        entryId: "e-1",
        participantProfileId: "p-1",
        band: "first",
        prize: "Trophy and certificate",
      },
      {
        entryId: "e-2",
        participantProfileId: "p-2",
        band: "second",
        prize: "Medal",
      },
      {
        entryId: "e-3",
        participantProfileId: "p-3",
        band: "third",
        prize: null,
      },
    ]);
  });

  it("gives finalists and special mentions no prize message", () => {
    const awarded = prizeAwards(LINES, {}).map((a) => a.entryId);
    expect(awarded).not.toContain("e-4");
    expect(awarded).not.toContain("e-5");
  });

  it("gives nothing for a snapshot with no banded lines", () => {
    expect(prizeAwards([LINES[3]!, LINES[4]!], { first: "Trophy" })).toEqual(
      []
    );
  });
});
