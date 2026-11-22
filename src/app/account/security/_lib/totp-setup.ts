// Showing a new authenticator secret: as a QR code for the app to scan,
// and as its setup key for typing by hand (screen readers, a camera that
// won't focus). Pure, no I/O.

import { encode } from "uqr";

/** Modules of light border every QR code needs around it to scan. */
const QUIET_ZONE = 4;

/** A setup key in groups of four: "ABCD EFGH …". */
export function groupKey(key: string): string {
  return key.match(/.{1,4}/g)?.join(" ") ?? key;
}

/**
 * The QR code for `text` as one SVG path of unit squares, `size` modules
 * across including the quiet zone.
 */
export function qrCode(text: string): { size: number; path: string } {
  const { data, size } = encode(text, { ecc: "M", border: 0 });
  const squares: string[] = [];
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) {
        squares.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`);
      }
    })
  );
  return { size: size + 2 * QUIET_ZONE, path: squares.join("") };
}
