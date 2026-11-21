import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  fullLogo,
  parseMaster,
  tilesOnly,
} from "../../../../../scripts/brand-logo";
import {
  STAMP_GEOMETRY,
  STAMP_VARIANTS,
  StampPlanError,
  planStamp,
  type StampPlan,
} from "./stamp-plan";

const master = parseMaster(
  readFileSync(
    new URL("../../../../../public/brand/foa-logo.svg", import.meta.url),
    "utf8"
  )
);

/** Every box lies on whole pixels inside the canvas. */
function expectInsideCanvas({ canvas, image, logo }: StampPlan) {
  for (const box of [image, logo]) {
    for (const value of [box.left, box.top, box.width, box.height]) {
      expect(Number.isInteger(value)).toBe(true);
    }
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.left + box.width).toBeLessThanOrEqual(canvas.width);
    expect(box.top + box.height).toBeLessThanOrEqual(canvas.height);
  }
}

describe("STAMP_GEOMETRY", () => {
  it("keeps the logo's proportions from the master, scaled only", () => {
    const full = fullLogo(master).viewBox;
    const tiles = tilesOnly(master).viewBox;
    expect(STAMP_GEOMETRY.logoAspect.full).toBeCloseTo(
      full.height / full.width,
      6
    );
    expect(STAMP_GEOMETRY.logoAspect.tiles).toBeCloseTo(
      tiles.height / tiles.width,
      6
    );
  });
});

describe("planStamp: gallery", () => {
  it("shrinks a large image so its long edge is 2048 px", () => {
    const plan = planStamp({ width: 4032, height: 3024 }, "gallery");
    expect(plan.canvas).toEqual({ width: 2048, height: 1536 });
    expect(plan.image).toEqual({ left: 0, top: 0, width: 2048, height: 1536 });
    expectInsideCanvas(plan);
  });

  it("never enlarges a smaller image", () => {
    const plan = planStamp({ width: 1600, height: 1200 }, "gallery");
    expect(plan.canvas).toEqual({ width: 1600, height: 1200 });
  });

  it("puts the full logo in the bottom-right corner, a fifth of the short edge wide", () => {
    const { logo } = planStamp({ width: 1600, height: 1200 }, "gallery");
    // short edge 1200: logo 240 wide, margin 36.
    expect(logo).toEqual({
      form: "full",
      width: 240,
      height: Math.round(240 * STAMP_GEOMETRY.logoAspect.full),
      left: 1600 - 36 - 240,
      top: 1200 - 36 - Math.round(240 * STAMP_GEOMETRY.logoAspect.full),
    });
  });
});

describe("planStamp: gallery_thumb", () => {
  it("is at most 480 px on the long edge", () => {
    const plan = planStamp({ width: 1600, height: 1067 }, "gallery_thumb");
    expect(plan.canvas).toEqual({ width: 480, height: 320 });
    expectInsideCanvas(plan);
  });

  it("uses the tiles alone, because the full logo would be narrower than the threshold", () => {
    const { logo } = planStamp({ width: 1600, height: 1067 }, "gallery_thumb");
    expect(Math.round(320 * 0.2)).toBeLessThan(STAMP_GEOMETRY.tilesOnlyBelowPx);
    expect(logo.form).toBe("tiles");
    expect(logo.height).toBe(
      Math.round(logo.width * STAMP_GEOMETRY.logoAspect.tiles)
    );
  });
});

describe("planStamp: social", () => {
  it("frames a landscape image in a 1080 x 1080 square, centred", () => {
    const plan = planStamp({ width: 1600, height: 1200 }, "social");
    expect(plan.canvas).toEqual({ width: 1080, height: 1080 });
    expect(plan.image).toEqual({ left: 0, top: 135, width: 1080, height: 810 });
    expect(plan.background).toBe(STAMP_GEOMETRY.background);
    expectInsideCanvas(plan);
  });

  it("frames a portrait image the other way", () => {
    const plan = planStamp({ width: 1200, height: 1600 }, "social");
    expect(plan.image).toEqual({ left: 135, top: 0, width: 810, height: 1080 });
  });

  it("doesn't enlarge a small image: it sits in the middle of the frame", () => {
    const plan = planStamp({ width: 600, height: 400 }, "social");
    expect(plan.image).toEqual({
      left: 240,
      top: 340,
      width: 600,
      height: 400,
    });
  });

  it("places the logo by the frame, not by the image inside it", () => {
    const { logo } = planStamp({ width: 600, height: 400 }, "social");
    // short edge 1080: logo 216 wide, margin 32.
    expect(logo.form).toBe("full");
    expect(logo.width).toBe(216);
    expect(logo.left).toBe(1080 - 32 - 216);
    expect(logo.top).toBe(1080 - 32 - logo.height);
  });
});

describe("planStamp: certificate_share", () => {
  it("is a 1080 x 1350 card with the logo centred at the top", () => {
    const plan = planStamp({ width: 1080, height: 1350 }, "certificate_share");
    expect(plan.canvas).toEqual({ width: 1080, height: 1350 });
    expect(plan.image).toEqual({ left: 0, top: 0, width: 1080, height: 1350 });
    expect(plan.logo.form).toBe("full");
    expect(plan.logo.top).toBe(32);
    const rightGap = 1080 - plan.logo.left - plan.logo.width;
    expect(Math.abs(plan.logo.left - rightGap)).toBeLessThanOrEqual(1);
    expectInsideCanvas(plan);
  });
});

describe("planStamp: limits", () => {
  it("keeps a minimum logo width on a small image", () => {
    const { logo } = planStamp({ width: 100, height: 60 }, "gallery");
    expect(logo.form).toBe("tiles");
    expect(logo.width).toBe(STAMP_GEOMETRY.minLogoWidthPx);
  });

  it("refuses an image too small to carry the logo with its margins", () => {
    expect(() => planStamp({ width: 50, height: 30 }, "gallery")).toThrow(
      StampPlanError
    );
    try {
      planStamp({ width: 50, height: 30 }, "gallery");
    } catch (error) {
      expect((error as StampPlanError).code).toBe("image_too_small");
    }
  });

  it("refuses sizes that aren't whole positive pixels", () => {
    for (const size of [
      { width: 0, height: 100 },
      { width: 100, height: -1 },
      { width: 100.5, height: 100 },
    ]) {
      expect(() => planStamp(size, "gallery")).toThrow(RangeError);
    }
  });

  it("plans every variant in the registry inside its canvas", () => {
    for (const variant of Object.keys(STAMP_VARIANTS) as Array<
      keyof typeof STAMP_VARIANTS
    >) {
      expectInsideCanvas(planStamp({ width: 3000, height: 2000 }, variant));
      expectInsideCanvas(planStamp({ width: 2000, height: 3000 }, variant));
    }
  });
});
