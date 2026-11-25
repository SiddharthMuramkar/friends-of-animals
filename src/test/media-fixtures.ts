// The committed media fixtures (fixtures/media/README.md says what each one
// holds and where it comes from), for tests only.

import { readFileSync } from "node:fs";

export const MEDIA_FIXTURES = {
  /** 2000 x 1500 JPEG with GPS, camera make and model, XMP and IPTC. */
  gpsJpeg: "gps.jpg",
  /** Stored 600 x 400 with EXIF Orientation 6: shows as a 400 x 600 portrait. */
  rotatedJpeg: "rotated.jpg",
  /**
   * A 1100 x 700 grid of HEVC tiles turned by its irot box, so it shows as
   * 700 x 1100, with GPS, camera make and model and EXIF Orientation 6.
   */
  iphoneHeic: "iphone.heic",
  /** gps.jpg cut short in its scan data: the header reads, the pixels don't. */
  corruptJpeg: "corrupt.jpg",
  /**
   * A 1 s QuickTime clip (H.264, AAC) stored 320 x 240 and turned a quarter
   * by its display matrix, so it shows as 240 x 320, with an ISO 6709
   * location, camera make and model and a creation time (#86).
   */
  gpsMov: "gps.mov",
  /** A 1 s WebM clip (VP8, Opus), 320 x 240, with a title tag (#86). */
  clipWebm: "clip.webm",
} as const;

export type MediaFixture = keyof typeof MEDIA_FIXTURES;

const DIR = new URL("../../fixtures/media/", import.meta.url);

/** A fixture's bytes, read fresh each call. */
export function readMediaFixture(name: MediaFixture): Uint8Array {
  return new Uint8Array(readFileSync(new URL(MEDIA_FIXTURES[name], DIR)));
}
