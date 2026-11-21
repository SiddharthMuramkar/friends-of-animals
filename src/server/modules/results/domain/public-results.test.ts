import { describe, expect, it } from "vitest";

import {
  publicResultsView,
  resultsCacheLife,
  type PublicCredit,
  type PublicResultLine,
} from "./public-results";

function line(over: Partial<PublicResultLine>): PublicResultLine {
  return {
    entryId: "e-1",
    entryCode: "NEIGH27-0001",
    discipline: "drawing",
    ageGroup: "8-10",
    outcome: "winner",
    awardPosition: 1,
    awardBand: "first",
    ...over,
  };
}

const credited = (name: string): PublicCredit => ({
  kind: "credited",
  name,
  school: null,
  city: null,
});

const LINES: PublicResultLine[] = [
  line({
    entryId: "e-7",
    entryCode: "NEIGH27-0007",
    discipline: "photography",
    outcome: "finalist",
    awardPosition: null,
    awardBand: null,
  }),
  line({
    entryId: "e-6",
    entryCode: "NEIGH27-0006",
    ageGroup: "11-13",
    outcome: "runner_up",
    awardPosition: 2,
    awardBand: "second",
  }),
  line({}),
  line({
    entryId: "e-2",
    entryCode: "NEIGH27-0002",
    outcome: "runner_up",
    awardPosition: 2,
    awardBand: "second",
  }),
  line({
    entryId: "e-3",
    entryCode: "NEIGH27-0003",
    outcome: "finalist",
    awardPosition: null,
    awardBand: null,
  }),
  line({
    entryId: "e-4",
    entryCode: "NEIGH27-0004",
    outcome: "special_mention",
    awardPosition: null,
    awardBand: null,
  }),
  line({
    entryId: "e-5",
    entryCode: "NEIGH27-0005",
    discipline: "painting",
    outcome: "runner_up",
    awardPosition: 3,
    awardBand: "third",
  }),
];

const CREDITS = new Map<string, PublicCredit>([
  ["e-1", credited("Asha K.")],
  ["e-2", { kind: "withheld" }],
  ["e-3", credited("Ravi Kumar")],
  ["e-4", credited("Meera I.")],
  ["e-5", credited("Kabir S.")],
  ["e-6", credited("Rohan D.")],
  ["e-7", credited("Fatima S.")],
]);

const view = (lines = LINES, credits = CREDITS) =>
  publicResultsView({
    disciplines: ["painting", "drawing"],
    ageGroups: ["8-10", "11-13"],
    lines,
    credits,
  });

describe("publicResultsView", () => {
  it("groups by discipline and age group in the competition's order", () => {
    expect(
      view().map((d) => [d.discipline, d.categories.map((c) => c.ageGroup)])
    ).toEqual([
      ["painting", ["8-10"]],
      ["drawing", ["8-10", "11-13"]],
      // Not in the competition's list: kept at the end, never dropped.
      ["photography", ["8-10"]],
    ]);
  });

  it("splits a category into placed lines by position, special mentions and finalists", () => {
    const drawing = view().find((d) => d.discipline === "drawing");
    const juniors = drawing?.categories.find((c) => c.ageGroup === "8-10");
    expect(juniors?.placed.map((l) => l.entryCode)).toEqual([
      "NEIGH27-0001",
      "NEIGH27-0002",
    ]);
    expect(juniors?.specialMentions.map((l) => l.entryCode)).toEqual([
      "NEIGH27-0004",
    ]);
    expect(juniors?.finalists.map((l) => l.entryCode)).toEqual([
      "NEIGH27-0003",
    ]);
  });

  it("shows the award and entry code with each line's credit", () => {
    const [painting] = view();
    expect(painting?.categories[0]?.placed).toEqual([
      {
        entryCode: "NEIGH27-0005",
        outcome: "runner_up",
        awardBand: "third",
        credit: credited("Kabir S."),
      },
    ]);
  });

  it("keeps a withheld line with its award but no name", () => {
    const drawing = view().find((d) => d.discipline === "drawing");
    const second = drawing?.categories[0]?.placed[1];
    expect(second).toEqual({
      entryCode: "NEIGH27-0002",
      outcome: "runner_up",
      awardBand: "second",
      credit: { kind: "withheld" },
    });
  });

  it("withholds a line the credit resolver said nothing about", () => {
    const credits = new Map(CREDITS);
    credits.delete("e-1");
    const drawing = view(LINES, credits).find(
      (d) => d.discipline === "drawing"
    );
    expect(drawing?.categories[0]?.placed[0]?.credit).toEqual({
      kind: "withheld",
    });
  });

  it("withholds a credit with a blank name", () => {
    const credits = new Map(CREDITS).set("e-1", credited("   "));
    const drawing = view(LINES, credits).find(
      (d) => d.discipline === "drawing"
    );
    expect(drawing?.categories[0]?.placed[0]?.credit).toEqual({
      kind: "withheld",
    });
  });

  it("copies only the credit's public fields, whatever else rides along", () => {
    const leaky = {
      kind: "credited",
      name: "Asha K.",
      school: "Green Valley School",
      city: null,
      dateOfBirth: "2016-04-02",
      guardianPhone: "+919800000000",
    } as PublicCredit;
    const credits = new Map(CREDITS).set("e-1", leaky);
    const json = JSON.stringify(view(LINES, credits));
    expect(json).toContain("Green Valley School");
    expect(json).not.toContain("2016-04-02");
    expect(json).not.toContain("+919800000000");
  });

  it("never carries entry ids", () => {
    expect(JSON.stringify(view())).not.toMatch(/"e-\d"/);
  });

  it("is empty when there are no lines", () => {
    expect(view([])).toEqual([]);
  });
});

describe("resultsCacheLife", () => {
  const T = new Date("2027-03-01T04:30:00.000Z");
  const at = (secondsFromT: number) =>
    new Date(T.getTime() + secondsFromT * 1000);

  it("keeps published results at most a minute before re-reading credits", () => {
    expect(resultsCacheLife({ state: "published" }, T)).toEqual({
      stale: 30,
      revalidate: 60,
      expire: 300,
    });
  });

  it("re-reads a competition with no results every minute", () => {
    expect(resultsCacheLife({ state: "none" }, T)).toEqual({
      stale: 30,
      revalidate: 60,
      expire: 300,
    });
  });

  it("re-reads a scheduled release at its publish instant", () => {
    expect(
      resultsCacheLife({ state: "scheduled", publishAt: T }, at(-10))
    ).toEqual({ stale: 30, revalidate: 10, expire: 11 });
    expect(
      resultsCacheLife({ state: "scheduled", publishAt: T }, at(-0.2))
    ).toEqual({ stale: 30, revalidate: 1, expire: 2 });
  });

  it("re-reads a far-off scheduled release every minute", () => {
    expect(
      resultsCacheLife({ state: "scheduled", publishAt: T }, at(-86_400))
    ).toEqual({ stale: 30, revalidate: 60, expire: 61 });
  });

  it("keeps re-reading every second once the instant has passed and the job hasn't run", () => {
    expect(
      resultsCacheLife({ state: "scheduled", publishAt: T }, at(5))
    ).toEqual({ stale: 30, revalidate: 1, expire: 2 });
  });
});
