import { describe, expect, it } from "vitest";

import messages from "../../../../messages/en-IN/awareness.json";
import {
  CARD,
  LOGO_TOP,
  cardLayout,
  cleanName,
  wrapWords,
} from "./pledge-text";

describe("cleanName", () => {
  it("keeps a first name or nickname, trimmed", () => {
    expect(cleanName("  Aarav  ")).toBe("Aarav");
    expect(cleanName("Mini-Moo")).toBe("Mini-Moo");
  });

  it("keeps Indian scripts", () => {
    expect(cleanName("आरव")).toBe("आरव");
    expect(cleanName("அருண்")).toBe("அருண்");
  });

  it("drops digits, symbols and anything after the first two words", () => {
    expect(cleanName("Riya 9876543210")).toBe("Riya");
    expect(cleanName("a@b.com")).toBe("abcom");
    expect(cleanName("Riya Sen Gupta")).toBe("Riya Sen");
  });

  it("caps the length", () => {
    expect(cleanName("x".repeat(60))).toHaveLength(20);
  });
});

describe("wrapWords", () => {
  const measure = (s: string) => s.length; // one unit per character

  it("wraps on word boundaries within the width", () => {
    expect(wrapWords("keep a water bowl full", 10, measure)).toEqual([
      "keep a",
      "water bowl",
      "full",
    ]);
  });

  it("lets a single long word overflow on its own line", () => {
    expect(wrapWords("hello extraordinarily", 6, measure)).toEqual([
      "hello",
      "extraordinarily",
    ]);
  });
});

describe("cardLayout", () => {
  const { pledge } = messages.awareness;
  // Node has no canvas. Half an em per character reproduces every wrap the
  // audit measured on the real card (see the first test).
  const estimate = (px: number) => (s: string) => s.length * px * 0.5;
  const measure = {
    lead: estimate(CARD.size.lead),
    promise: estimate(CARD.size.promise),
  };
  const layout = (name: string, promise: string) =>
    cardLayout(
      {
        lead: name
          ? pledge.cardWithName.replace("{name}", cleanName(name))
          : pledge.cardNoName,
        promise: `${promise}.`,
      },
      measure
    );
  // The longest name the card allows: two words, 20 characters.
  const LONG_NAME = "Lakshmi Narasimhamma";
  // Rough ink extents of a line around its baseline.
  const ascent = (px: number) => px * 0.8;
  const descent = (px: number) => px * 0.25;

  it("estimates the wraps measured in the browser", () => {
    expect(layout("Lakshmi Narasimhan", pledge.promises.bin).lead).toHaveLength(
      2
    );
    expect(layout("Venkatalakshmi", pledge.promises.bin).lead).toHaveLength(1);
    expect(layout("Sai Krishna", pledge.promises.bin).lead).toHaveLength(1);
    for (const id of ["water", "distance", "grownUp"] as const)
      expect(layout("", pledge.promises[id]).promise).toHaveLength(3);
  });

  it("keeps the quote at its resting place when there is room", () => {
    const l = layout("", pledge.promises.bin);
    expect(l.quoteY).toBe(CARD.height - 400);
    expect(l.sourceY).toBe(CARD.height - 354);
  });

  it("moves the quote down when a long name and promise reach it", () => {
    const l = layout("Lakshmi Narasimhan", pledge.promises.water);
    expect(l.lead).toHaveLength(2);
    expect(l.promise).toHaveLength(3);
    expect(l.quoteY).toBeGreaterThan(CARD.height - 400);
  });

  it("tests with a name the card keeps whole", () => {
    expect(cleanName(LONG_NAME)).toBe(LONG_NAME);
    expect(LONG_NAME).toHaveLength(20);
  });

  describe.each(Object.entries(pledge.promises))("%s", (_, promise) => {
    it.each(["", LONG_NAME])("has no overlap with the name %j", (name) => {
      const l = layout(name, promise);
      const lastLead = l.lead.at(-1)!;
      const firstPromise = l.promise[0]!;
      const lastPromise = l.promise.at(-1)!;
      const pillBottom = l.pillY + CARD.pillHeight;

      expect(lastLead.y + descent(CARD.size.lead)).toBeLessThanOrEqual(
        firstPromise.y - ascent(CARD.size.promise)
      );
      expect(lastPromise.y + descent(CARD.size.promise)).toBeLessThanOrEqual(
        l.pillY
      );
      expect(pillBottom).toBeLessThanOrEqual(
        l.quoteY - ascent(CARD.size.quote)
      );
      expect(l.quoteY + descent(CARD.size.quote)).toBeLessThanOrEqual(
        l.sourceY - ascent(CARD.size.source)
      );
      expect(l.sourceY + descent(CARD.size.source)).toBeLessThanOrEqual(
        LOGO_TOP
      );
    });
  });
});
