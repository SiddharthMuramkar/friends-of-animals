import { describe, expect, it } from "vitest";

import {
  LOGO_THRESHOLDS,
  chooseLogoVariant,
  meanLuminance,
  relativeLuminance,
} from "./logo-choice";

/** WCAG 2 contrast ratio between two relative luminances. */
const contrast = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** One grey sRGB value repeated as `count` opaque RGB pixels. */
const greyPixels = (value: number, count = 4) =>
  new Uint8Array(count * 3).fill(value);

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 10);
  });

  it("linearises sRGB, so mid grey is far darker than half", () => {
    expect(relativeLuminance(128, 128, 128)).toBeCloseTo(0.2159, 4);
  });

  it("weights green most and blue least", () => {
    expect(relativeLuminance(0, 255, 0)).toBeCloseTo(0.7152, 4);
    expect(relativeLuminance(255, 0, 0)).toBeCloseTo(0.2126, 4);
    expect(relativeLuminance(0, 0, 255)).toBeCloseTo(0.0722, 4);
  });
});

describe("meanLuminance", () => {
  it("averages opaque RGB pixels", () => {
    const blackAndWhite = new Uint8Array([0, 0, 0, 255, 255, 255]);
    expect(meanLuminance(blackAndWhite, 3)).toBeCloseTo(0.5, 10);
  });

  it("reads RGBA pixels and ignores alpha, because the adapter flattens first", () => {
    const rgba = new Uint8Array([255, 255, 255, 0, 255, 255, 255, 128]);
    expect(meanLuminance(rgba, 4)).toBeCloseTo(1, 10);
  });

  it("refuses an empty region", () => {
    expect(() => meanLuminance(new Uint8Array(0), 3)).toThrow(RangeError);
  });

  it("refuses bytes that aren't whole pixels", () => {
    expect(() => meanLuminance(new Uint8Array(5), 3)).toThrow(RangeError);
    expect(() => meanLuminance(new Uint8Array(6), 4)).toThrow(RangeError);
  });
});

describe("chooseLogoVariant", () => {
  it.each([
    { region: "black", grey: 0, variant: "white" },
    { region: "dark grey", grey: 80, variant: "white" },
    { region: "mid grey", grey: 128, variant: "colour" },
    { region: "light grey", grey: 200, variant: "colour" },
    { region: "very light", grey: 245, variant: "black" },
    { region: "white", grey: 255, variant: "black" },
  ] as const)(
    "puts the $variant logo on a $region region",
    ({ grey, variant }) => {
      const region = { meanLuminance: meanLuminance(greyPixels(grey), 3) };
      expect(chooseLogoVariant(region, "full")).toBe(variant);
    }
  );

  it("switches to white where white ink starts to out-contrast the black wordmark", () => {
    const { whiteBelow } = LOGO_THRESHOLDS;
    expect(contrast(1, whiteBelow)).toBeCloseTo(contrast(whiteBelow, 0), 9);
    expect(chooseLogoVariant({ meanLuminance: whiteBelow }, "full")).toBe(
      "colour"
    );
    expect(
      chooseLogoVariant({ meanLuminance: whiteBelow - 1e-6 }, "full")
    ).toBe("white");
  });

  it("uses the black logo from the very-light threshold up", () => {
    const { blackFrom } = LOGO_THRESHOLDS;
    expect(chooseLogoVariant({ meanLuminance: blackFrom }, "full")).toBe(
      "black"
    );
    expect(chooseLogoVariant({ meanLuminance: blackFrom - 1e-6 }, "full")).toBe(
      "colour"
    );
  });

  it("always uses the colour tiles when the logo is small, whatever the region", () => {
    for (const meanLuminance of [0, 0.1, 0.5, 0.9, 1]) {
      expect(chooseLogoVariant({ meanLuminance }, "tiles")).toBe("tiles");
    }
  });

  it("refuses a luminance outside 0 to 1", () => {
    for (const meanLuminance of [-0.01, 1.01, Number.NaN]) {
      expect(() => chooseLogoVariant({ meanLuminance }, "full")).toThrow(
        RangeError
      );
    }
  });
});
