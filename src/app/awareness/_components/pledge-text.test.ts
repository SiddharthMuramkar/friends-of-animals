import { describe, expect, it } from "vitest";

import { cleanName, wrapWords } from "./pledge-text";

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
