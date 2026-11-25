import { describe, expect, it } from "vitest";
import { zoomBy, pinchZoom, clampPan } from "./zoom";
describe("image inspection zoom", () => {
  it("keeps zoom within a fit-to-viewport and 400 percent range", () => {
    expect(zoomBy(1, -0.5)).toBe(1);
    expect(zoomBy(1, 0.5)).toBe(1.5);
    expect(zoomBy(3.8, 0.5)).toBe(4);
    expect(pinchZoom(2, 100, 150)).toBe(3);
    expect(pinchZoom(2, 0, 150)).toBe(2);
  });
  it("prevents a panned image disappearing beyond its viewport", () => {
    expect(
      clampPan(
        { x: 300, y: -400 },
        2,
        { width: 400, height: 300 },
        { width: 500, height: 400 }
      )
    ).toEqual({ x: 150, y: -100 });
    expect(
      clampPan(
        { x: 300, y: -400 },
        1,
        { width: 400, height: 300 },
        { width: 500, height: 400 }
      )
    ).toEqual({ x: 0, y: 0 });
  });
});
