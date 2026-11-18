import { describe, expect, it } from "vitest";

import { moveCursor, outlineToPath } from "./doodle-math";

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

describe("moveCursor", () => {
  const box = { width: 400, height: 300 };

  it("moves by 10 px, or 40 px with Shift", () => {
    expect(moveCursor({ x: 100, y: 100 }, "ArrowRight", false, box)).toEqual({
      x: 110,
      y: 100,
    });
    expect(moveCursor({ x: 100, y: 100 }, "ArrowUp", true, box)).toEqual({
      x: 100,
      y: 60,
    });
  });

  it("stays inside the pad", () => {
    expect(moveCursor({ x: 5, y: 295 }, "ArrowLeft", true, box)).toEqual({
      x: 0,
      y: 295,
    });
    expect(moveCursor({ x: 5, y: 295 }, "ArrowDown", true, box)).toEqual({
      x: 5,
      y: 300,
    });
  });

  it("ignores other keys", () => {
    expect(moveCursor({ x: 1, y: 2 }, "a", false, box)).toBeNull();
  });
});
