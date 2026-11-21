import { describe, expect, it } from "vitest";

import type { LogoVariant } from "./logo-choice";
import { stampSettingsKey } from "./settings-key";

const checksum = (digit: string) => digit.repeat(64);

const LOGOS: Record<LogoVariant, string> = {
  colour: checksum("a"),
  white: checksum("b"),
  black: checksum("c"),
  tiles: checksum("d"),
};

describe("stampSettingsKey", () => {
  it("is a SHA-256 hex digest", () => {
    expect(
      stampSettingsKey({ variant: "gallery", logoChecksums: LOGOS })
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the same for the same settings, whatever order the keys come in", () => {
    const reordered: Record<LogoVariant, string> = {
      tiles: LOGOS.tiles,
      black: LOGOS.black,
      white: LOGOS.white,
      colour: LOGOS.colour,
    };
    expect(
      stampSettingsKey({
        variant: "certificate_share",
        logoChecksums: LOGOS,
        content: { number: "FOA-C-27-0123456789", credit: "Asha K." },
      })
    ).toBe(
      stampSettingsKey({
        variant: "certificate_share",
        logoChecksums: reordered,
        content: { credit: "Asha K.", number: "FOA-C-27-0123456789" },
      })
    );
  });

  it("changes with the variant", () => {
    expect(
      stampSettingsKey({ variant: "gallery", logoChecksums: LOGOS })
    ).not.toBe(stampSettingsKey({ variant: "social", logoChecksums: LOGOS }));
  });

  it("changes when any logo file changes", () => {
    const base = stampSettingsKey({ variant: "gallery", logoChecksums: LOGOS });
    for (const variant of Object.keys(LOGOS) as LogoVariant[]) {
      const changed = { ...LOGOS, [variant]: checksum("e") };
      expect(
        stampSettingsKey({ variant: "gallery", logoChecksums: changed })
      ).not.toBe(base);
    }
  });

  it("changes when the card's content changes", () => {
    const key = (credit: string) =>
      stampSettingsKey({
        variant: "certificate_share",
        logoChecksums: LOGOS,
        content: { credit },
      });
    expect(key("Asha K.")).not.toBe(key("Asha Kulkarni"));
  });

  it("treats no content the same as empty content", () => {
    expect(stampSettingsKey({ variant: "gallery", logoChecksums: LOGOS })).toBe(
      stampSettingsKey({
        variant: "gallery",
        logoChecksums: LOGOS,
        content: {},
      })
    );
  });

  it("refuses a logo checksum that isn't a SHA-256 hex digest", () => {
    expect(() =>
      stampSettingsKey({
        variant: "gallery",
        logoChecksums: { ...LOGOS, white: "not-a-digest" },
      })
    ).toThrow(RangeError);
  });
});
