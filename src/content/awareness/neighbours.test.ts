import { describe, expect, it } from "vitest";

import { fleschKincaidGrade } from "@/content/stories/text";

import { NEIGHBOURS, neighbour } from "./neighbours";
import { BITE_FIRST_AID, HURT_ANIMAL_KID_STEPS } from "./rescue";

const KID_COPY_BANS =
  /\b(feed (it|them|the)|give (it|them) (milk|bread|roti|sweets)|pick (it|them) up|pet (it|them)|stroke)\b/i;

describe("NEIGHBOURS", () => {
  it("has the ten street neighbours in page order", () => {
    expect(NEIGHBOURS.map((n) => n.id)).toEqual([
      "indie-dog",
      "street-cat",
      "cow",
      "house-crow",
      "common-myna",
      "rock-pigeon",
      "house-sparrow",
      "black-kite",
      "palm-squirrel",
      "asian-koel",
    ]);
  });

  it("gives every card a sourced fact and good-neighbour lines", () => {
    for (const n of NEIGHBOURS) {
      expect(n.sources.length, n.id).toBeGreaterThan(0);
      for (const s of n.sources) expect(s.url, n.id).toMatch(/^https:\/\//);
      expect(n.good.length, n.id).toBeGreaterThanOrEqual(1);
      expect(n.avoid.length, n.id).toBeGreaterThanOrEqual(1);
    }
  });

  it("never tells a child to feed, touch or pick up an animal", () => {
    for (const n of NEIGHBOURS) {
      for (const line of [n.fact, ...n.good]) {
        expect(line, n.id).not.toMatch(KID_COPY_BANS);
        expect(line, n.id).not.toMatch(/^feed\b/i);
      }
    }
  });

  it.each(NEIGHBOURS.map((n) => n.id))(
    "%s kid lines read at grade 6 or below",
    (id) => {
      const n = neighbour(id);
      const kid = [n.fact, ...n.good, ...n.avoid].join(" ");
      expect(fleschKincaidGrade(kid)).toBeLessThanOrEqual(6);
    }
  );

  it("keeps kid steps for a hurt animal at grade 6 or below", () => {
    expect(
      fleschKincaidGrade(HURT_ANIMAL_KID_STEPS.join(" "))
    ).toBeLessThanOrEqual(6);
  });

  it("puts Ruskin Bond's sparrow line on the sparrow", () => {
    expect(neighbour("house-sparrow").quoteId).toBe("Q34");
  });
});

describe("hurt-animal steps", () => {
  it("sends the child to a grown-up and keeps hands off", () => {
    expect(HURT_ANIMAL_KID_STEPS).toHaveLength(6);
    expect(HURT_ANIMAL_KID_STEPS.join(" ")).toMatch(/grown-up/);
    expect(HURT_ANIMAL_KID_STEPS[0]).toMatch(/do not touch/i);
  });

  it("gives NCDC bite first aid: 15 minutes of washing, no home remedies", () => {
    const text = BITE_FIRST_AID.map((s) => s.text).join(" ");
    expect(text).toMatch(/15 minutes/);
    expect(text).toMatch(/same day/);
    expect(text).toMatch(/never put chilli, oil, turmeric or lime/i);
  });
});
