import { describe, expect, it } from "vitest";

import { sniffImageType } from "./image-type";

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

/** The first bytes of an ISO base media file: box size, "ftyp", brand. */
function ftyp(majorBrand: string, compatible: string[] = []): Uint8Array {
  const body = [
    ...ascii("ftyp"),
    ...ascii(majorBrand),
    0,
    0,
    0,
    0,
    ...compatible.flatMap(ascii),
  ];
  return new Uint8Array([0, 0, 0, body.length + 4, ...body]);
}

describe("sniffImageType", () => {
  it("knows JPEG, PNG and WebP by their signatures", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0]))).toBe(
      "image/jpeg"
    );
    expect(
      sniffImageType(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
      )
    ).toBe("image/png");
    expect(
      sniffImageType(
        new Uint8Array([...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBPVP8 ")])
      )
    ).toBe("image/webp");
  });

  it("knows an iPhone HEIC photo by its ftyp brand", () => {
    for (const brand of ["heic", "heix", "heim", "heis"]) {
      expect(sniffImageType(ftyp(brand, ["mif1", "heic"]))).toBe("image/heic");
    }
  });

  it("calls a generic HEIF file HEIF, and HEVC-coded compatible ones HEIC", () => {
    expect(sniffImageType(ftyp("mif1", ["mif1"]))).toBe("image/heif");
    expect(sniffImageType(ftyp("msf1", ["msf1"]))).toBe("image/heif");
    expect(sniffImageType(ftyp("mif1", ["mif1", "heic"]))).toBe("image/heic");
  });

  it("doesn't take AVIF, MP4 or QuickTime for an image it accepts", () => {
    expect(sniffImageType(ftyp("avif", ["mif1", "avif"]))).toBeNull();
    expect(sniffImageType(ftyp("isom", ["isom", "mp41"]))).toBeNull();
    expect(sniffImageType(ftyp("qt  "))).toBeNull();
  });

  it("returns null for anything else, including too few bytes", () => {
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(new Uint8Array(ascii("GIF89a")))).toBeNull();
    expect(sniffImageType(new Uint8Array(ascii("%PDF-1.7")))).toBeNull();
    expect(
      sniffImageType(new Uint8Array(ascii("RIFF\0\0\0\0WAVE")))
    ).toBeNull();
  });

  it("reads brands only as far as the bytes go when given a file's head", () => {
    const head = ftyp("mif1", ["heic"]);
    head[3] = 200; // the box is longer than the bytes passed in
    expect(sniffImageType(head)).toBe("image/heic");
  });

  it("stops at the ftyp box's own end", () => {
    const bytes = new Uint8Array([...ftyp("mif1", ["mif1"]), ...ascii("heic")]);
    expect(sniffImageType(bytes)).toBe("image/heif");
  });
});
