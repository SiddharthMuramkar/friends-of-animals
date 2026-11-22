import { describe, expect, it } from "vitest";

import {
  DERIVATIVE_KINDS,
  fitInside,
  orientedSize,
  planImageDerivatives,
} from "./derivatives";

describe("orientedSize", () => {
  it("keeps width and height for orientations that don't turn the image", () => {
    for (const orientation of [undefined, 1, 2, 3, 4]) {
      expect(orientedSize({ width: 4032, height: 3024 }, orientation)).toEqual({
        width: 4032,
        height: 3024,
      });
    }
  });

  it("swaps width and height for orientations that turn it a quarter", () => {
    for (const orientation of [5, 6, 7, 8]) {
      expect(orientedSize({ width: 4032, height: 3024 }, orientation)).toEqual({
        width: 3024,
        height: 4032,
      });
    }
  });

  it("treats an orientation outside 1 to 8 as upright", () => {
    for (const orientation of [0, 9, -1, 6.5]) {
      expect(orientedSize({ width: 40, height: 30 }, orientation)).toEqual({
        width: 40,
        height: 30,
      });
    }
  });
});

describe("fitInside", () => {
  it("scales a landscape image so its long edge is the box", () => {
    expect(fitInside({ width: 4032, height: 3024 }, 1600)).toEqual({
      width: 1600,
      height: 1200,
    });
  });

  it("scales a portrait image so its long edge is the box", () => {
    expect(fitInside({ width: 3024, height: 4032 }, 320)).toEqual({
      width: 240,
      height: 320,
    });
  });

  it("rounds the short edge to the nearest pixel", () => {
    // 1000 x 333 into 320: 333 * 0.32 = 106.56.
    expect(fitInside({ width: 1000, height: 333 }, 320)).toEqual({
      width: 320,
      height: 107,
    });
  });

  it("never enlarges an image already inside the box", () => {
    expect(fitInside({ width: 800, height: 600 }, 1600)).toEqual({
      width: 800,
      height: 600,
    });
    expect(fitInside({ width: 1600, height: 900 }, 1600)).toEqual({
      width: 1600,
      height: 900,
    });
  });

  it("keeps a very thin image at least one pixel wide", () => {
    expect(fitInside({ width: 10000, height: 2 }, 320)).toEqual({
      width: 320,
      height: 1,
    });
  });

  it("refuses a size that isn't a positive whole number of pixels", () => {
    for (const size of [
      { width: 0, height: 10 },
      { width: 10, height: -1 },
      { width: 10.5, height: 10 },
      { width: Number.NaN, height: 10 },
    ]) {
      expect(() => fitInside(size, 320)).toThrow(RangeError);
    }
  });
});

describe("DERIVATIVE_KINDS", () => {
  it("makes WebP thumbnails and display copies of entry images", () => {
    expect(DERIVATIVE_KINDS.thumb_320).toMatchObject({
      maxEdge: 320,
      contentType: "image/webp",
    });
    expect(DERIVATIVE_KINDS.display_1600).toMatchObject({
      maxEdge: 1600,
      contentType: "image/webp",
    });
  });
});

describe("planImageDerivatives", () => {
  it("plans each kind from the upright size of the source", () => {
    // An iPhone portrait photo: stored landscape, EXIF orientation 6.
    expect(
      planImageDerivatives({ width: 4032, height: 3024, orientation: 6 }, [
        "thumb_320",
        "display_1600",
      ])
    ).toEqual([
      {
        kind: "thumb_320",
        width: 240,
        height: 320,
        contentType: "image/webp",
      },
      {
        kind: "display_1600",
        width: 1200,
        height: 1600,
        contentType: "image/webp",
      },
    ]);
  });

  it("keeps a small source at its own size in every kind it fits", () => {
    expect(
      planImageDerivatives({ width: 300, height: 200 }, [
        "thumb_320",
        "display_1600",
      ])
    ).toEqual([
      {
        kind: "thumb_320",
        width: 300,
        height: 200,
        contentType: "image/webp",
      },
      {
        kind: "display_1600",
        width: 300,
        height: 200,
        contentType: "image/webp",
      },
    ]);
  });

  it("plans only the kinds asked for, once each, in the order given", () => {
    expect(
      planImageDerivatives({ width: 2000, height: 1000 }, [
        "display_1600",
        "display_1600",
      ]).map((derivative) => derivative.kind)
    ).toEqual(["display_1600"]);
  });
});
