import { describe, expect, it } from "vitest";

import { readMediaFixture } from "@/test/media-fixtures";

import { SNIFF_BYTES, sniffContentType } from "./sniff";

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => new TextEncoder().encode(text);

describe("sniffContentType", () => {
  it("recognises a PNG", () => {
    expect(
      sniffContentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))
    ).toBe("image/png");
  });

  it("recognises a JPEG", () => {
    expect(sniffContentType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe(
      "image/jpeg"
    );
  });

  it("recognises a WebP", () => {
    const webp = new Uint8Array(12);
    webp.set(ascii("RIFF"), 0);
    webp.set(bytes(0x24, 0, 0, 0), 4);
    webp.set(ascii("WEBP"), 8);
    expect(sniffContentType(webp)).toBe("image/webp");
  });

  it("recognises an iPhone's HEIC, and a HEIF named only by its compatible brands", () => {
    expect(
      sniffContentType(readMediaFixture("iphoneHeic").subarray(0, SNIFF_BYTES))
    ).toBe("image/heic");
    const heif = new Uint8Array(24);
    heif.set(bytes(0, 0, 0, 24), 0);
    heif.set(ascii("ftypmif1"), 4);
    heif.set(ascii("mif1miaf"), 16);
    expect(sniffContentType(heif)).toBe("image/heif");
  });

  it("doesn't take an AVIF or a video for a HEIF", () => {
    const avif = new Uint8Array(24);
    avif.set(bytes(0, 0, 0, 24), 0);
    avif.set(ascii("ftypmif1"), 4);
    avif.set(ascii("avifmiaf"), 16);
    const mp4 = new Uint8Array(24);
    mp4.set(bytes(0, 0, 0, 24), 0);
    mp4.set(ascii("ftypisom"), 4);
    expect(sniffContentType(avif)).toBeNull();
    expect(sniffContentType(mp4)).toBeNull();
  });

  it("recognises a PDF", () => {
    expect(sniffContentType(ascii("%PDF-1.7\n"))).toBe("application/pdf");
  });

  it("doesn't take a RIFF that isn't WebP for one", () => {
    const wav = new Uint8Array(12);
    wav.set(ascii("RIFF"), 0);
    wav.set(ascii("WAVE"), 8);
    expect(sniffContentType(wav)).toBeNull();
  });

  it("returns null for anything else, or too few bytes", () => {
    for (const head of [
      ascii("<!doctype html>"),
      ascii("<svg xmlns"),
      ascii("GIF89a"),
      bytes(0x89, 0x50, 0x4e),
      bytes(0xff, 0xd8),
      new Uint8Array(0),
    ]) {
      expect(sniffContentType(head)).toBeNull();
    }
  });

  it("needs no more than SNIFF_BYTES bytes", () => {
    const pdf = ascii("%PDF-1.7\n%âãÏÓ\n1 0 obj");
    expect(sniffContentType(pdf.subarray(0, SNIFF_BYTES))).toBe(
      "application/pdf"
    );
  });
});
