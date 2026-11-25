import { describe, expect, it } from "vitest";

import {
  VIDEO_SNIFF_BYTES,
  sameVideoFamily,
  sniffVideoType,
} from "./video-sniff";

/** An ISO base media `ftyp` box: major brand, minor version, compatibles. */
function ftyp(major: string, compatible: string[] = []): Uint8Array {
  const size = 16 + compatible.length * 4;
  const text = `${major}\0\0\0\0${compatible.join("")}`;
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(new TextEncoder().encode("ftyp"), 4);
  bytes.set(new TextEncoder().encode(text), 8);
  return bytes;
}

/** An EBML header naming its document type, as WebM and Matroska start. */
function ebml(docType: string): Uint8Array {
  const name = new TextEncoder().encode(docType);
  return new Uint8Array([
    0x1a,
    0x45,
    0xdf,
    0xa3,
    0x9f,
    0x42,
    0x86,
    0x81,
    0x01,
    0x42,
    0xf7,
    0x81,
    0x01,
    0x42,
    0x82,
    0x80 | name.length,
    ...name,
    0x42,
    0x87,
    0x81,
    0x04,
  ]);
}

describe("sniffVideoType", () => {
  it("reads at least enough bytes for the brands and the WebM doc type", () => {
    expect(VIDEO_SNIFF_BYTES).toBeGreaterThanOrEqual(64);
  });

  it("spots an iPhone QuickTime movie", () => {
    expect(sniffVideoType(ftyp("qt  ", ["qt  "]))).toBe("video/quicktime");
  });

  it("spots MP4s from Android phones and editors", () => {
    for (const brand of [
      "isom",
      "mp42",
      "mp41",
      "avc1",
      "iso5",
      "M4V ",
      "mmp4",
    ]) {
      expect(sniffVideoType(ftyp(brand, ["isom"]))).toBe("video/mp4");
    }
  });

  it("spots 3GP recordings from older phones", () => {
    expect(sniffVideoType(ftyp("3gp4", ["isom", "3gp4"]))).toBe("video/3gpp");
    expect(sniffVideoType(ftyp("3gp6"))).toBe("video/3gpp");
  });

  it("goes by the compatible brands when the major brand is unfamiliar", () => {
    expect(sniffVideoType(ftyp("XAVC", ["XAVC", "mp42", "iso2"]))).toBe(
      "video/mp4"
    );
    expect(sniffVideoType(ftyp("abcd", ["qt  "]))).toBe("video/quicktime");
    expect(sniffVideoType(ftyp("abcd", ["abcd"]))).toBeNull();
  });

  it("doesn't mistake HEIC photos or audio-only files for video", () => {
    expect(sniffVideoType(ftyp("heic", ["mif1", "heic"]))).toBeNull();
    expect(sniffVideoType(ftyp("mif1", ["mif1", "heic"]))).toBeNull();
    expect(sniffVideoType(ftyp("avif", ["avif", "mif1"]))).toBeNull();
    expect(sniffVideoType(ftyp("M4A ", ["M4A ", "isom"]))).toBeNull();
  });

  it("spots WebM but not other Matroska files", () => {
    expect(sniffVideoType(ebml("webm"))).toBe("video/webm");
    expect(sniffVideoType(ebml("matroska"))).toBeNull();
  });

  it("returns null for images, PDFs, scripts and too few bytes", () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(sniffVideoType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(sniffVideoType(encode("%PDF-1.7\n"))).toBeNull();
    expect(sniffVideoType(encode("<script>alert(1)</script>"))).toBeNull();
    expect(sniffVideoType(ftyp("qt  ").subarray(0, 10))).toBeNull();
    expect(sniffVideoType(new Uint8Array())).toBeNull();
  });
});

describe("sameVideoFamily", () => {
  it("accepts an exact match", () => {
    expect(sameVideoFamily("video/webm", "video/webm")).toBe(true);
    expect(sameVideoFamily("video/mp4", "video/mp4")).toBe(true);
  });

  it("treats MP4, QuickTime and 3GP as one family, as phones label them loosely", () => {
    expect(sameVideoFamily("video/mp4", "video/quicktime")).toBe(true);
    expect(sameVideoFamily("video/quicktime", "video/mp4")).toBe(true);
    expect(sameVideoFamily("video/3gpp", "video/mp4")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(sameVideoFamily("video/webm", "video/mp4")).toBe(false);
    expect(sameVideoFamily("video/mp4", null)).toBe(false);
    expect(sameVideoFamily("image/png", "video/mp4")).toBe(false);
  });
});
