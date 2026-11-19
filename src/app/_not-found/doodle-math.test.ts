import { describe, expect, it } from "vitest";

import {
  bitmapSize,
  moveCursor,
  outlineToPath,
  PAD,
  PAD_CENTRE,
  strokeOwner,
  toPad,
  toPercent,
} from "./doodle-math";

describe("outlineToPath", () => {
  it("returns an empty path for too few points", () => {
    expect(outlineToPath([[0, 0]])).toBe("");
  });

  it("builds a closed quadratic path", () => {
    const d = outlineToPath([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(d.startsWith("M0,0 Q10,0 10,5 T")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });
});

describe("the pad's logical space", () => {
  it("is 4:3, centred on the cursor's start", () => {
    expect(PAD.width / PAD.height).toBeCloseTo(4 / 3);
    expect(PAD_CENTRE).toEqual({ x: PAD.width / 2, y: PAD.height / 2 });
  });
});

describe("toPad", () => {
  it("maps the pad's box onto pad units", () => {
    const box = { left: 20, top: 100, width: 400, height: 300 };
    expect(toPad(20, 100, box)).toEqual({ x: 0, y: 0 });
    expect(toPad(220, 250, box)).toEqual(PAD_CENTRE);
    expect(toPad(420, 400, box)).toEqual({ x: PAD.width, y: PAD.height });
  });

  it("keeps a drawing whole across a rotation", () => {
    // Drawn near the right edge of a landscape pad...
    const landscape = { left: 24, top: 0, width: 768, height: 576 };
    const at = toPad(24 + 700, 400, landscape);
    // ...it stays inside the pad, at the same place relative to it, when the
    // pad shrinks to a 358 px portrait width.
    expect(at.x).toBeLessThanOrEqual(PAD.width);
    expect((at.x / PAD.width) * 358).toBeCloseTo((700 / 768) * 358);
  });

  it("falls back to the centre before the pad has a size", () => {
    expect(toPad(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toEqual(
      PAD_CENTRE
    );
  });
});

describe("toPercent", () => {
  it("places a pad point relative to the pad's box", () => {
    expect(toPercent(PAD_CENTRE)).toEqual({ left: "50%", top: "50%" });
    expect(toPercent({ x: 0, y: PAD.height })).toEqual({
      left: "0%",
      top: "100%",
    });
  });
});

describe("bitmapSize", () => {
  it("uses device pixels, up to 2×", () => {
    expect(bitmapSize({ width: 400, height: 300 }, 1.5)).toMatchObject({
      width: 600,
      height: 450,
    });
    expect(bitmapSize({ width: 400, height: 300 }, 3)).toMatchObject({
      width: 800,
      height: 600,
    });
  });

  it("caps the pixel count on big pads", () => {
    const { width, height } = bitmapSize({ width: 1600, height: 1200 }, 2);
    expect(width * height).toBeLessThanOrEqual(2_500_000 * 1.001);
  });

  it("scales pad units onto the bitmap", () => {
    const { scaleX, scaleY } = bitmapSize({ width: 360, height: 270 }, 2);
    expect(scaleX).toBeCloseTo(720 / PAD.width);
    expect(scaleY).toBeCloseTo(540 / PAD.height);
  });

  it("never makes an empty bitmap", () => {
    expect(bitmapSize({ width: 0, height: 0 }, 2)).toMatchObject({
      width: 1,
      height: 1,
    });
  });
});

describe("moveCursor", () => {
  it("moves 15 pad units, or 60 with Shift", () => {
    expect(moveCursor({ x: 100, y: 100 }, "ArrowRight", false)).toEqual({
      x: 115,
      y: 100,
    });
    expect(moveCursor({ x: 100, y: 100 }, "ArrowUp", true)).toEqual({
      x: 100,
      y: 40,
    });
  });

  it("stays inside the pad", () => {
    expect(moveCursor({ x: 5, y: 880 }, "ArrowLeft", true)).toEqual({
      x: 0,
      y: 880,
    });
    expect(moveCursor({ x: 5, y: 880 }, "ArrowDown", true)).toEqual({
      x: 5,
      y: PAD.height,
    });
  });

  it("takes another box", () => {
    expect(
      moveCursor({ x: 395, y: 0 }, "ArrowRight", false, {
        width: 400,
        height: 300,
      })
    ).toEqual({ x: 400, y: 0 });
  });

  it("ignores other keys", () => {
    expect(moveCursor({ x: 1, y: 2 }, "a", false)).toBeNull();
  });
});

describe("strokeOwner", () => {
  it("lets only the first primary pointer draw", () => {
    const stroke = strokeOwner();
    expect(stroke.claim({ pointerId: 1, isPrimary: true })).toBe(true);
    // A second finger, or a palm, while the first is down.
    expect(stroke.claim({ pointerId: 2, isPrimary: false })).toBe(false);
    expect(stroke.owns(1)).toBe(true);
    expect(stroke.owns(2)).toBe(false);
  });

  it("keeps the stroke when another finger lifts", () => {
    const stroke = strokeOwner();
    stroke.claim({ pointerId: 1, isPrimary: true });
    expect(stroke.release(2)).toBe(false);
    expect(stroke.owns(1)).toBe(true);
  });

  it("ends the stroke once, when its own pointer lifts or loses capture", () => {
    const stroke = strokeOwner();
    stroke.claim({ pointerId: 1, isPrimary: true });
    expect(stroke.release(1)).toBe(true);
    // lostpointercapture follows pointerup.
    expect(stroke.release(1)).toBe(false);
    expect(stroke.claim({ pointerId: 3, isPrimary: true })).toBe(true);
  });

  it("ignores a non-primary pointer even when free", () => {
    expect(strokeOwner().claim({ pointerId: 4, isPrimary: false })).toBe(false);
  });
});
