import { describe, expect, it } from "vitest";

import { contentMd5ForEtag, normaliseEtag } from "./etag";

// MD5 of the empty string, as hex and as base64 (RFC 1321 test suite).
const EMPTY_MD5_HEX = "d41d8cd98f00b204e9800998ecf8427e";
const EMPTY_MD5_BASE64 = "1B2M2Y8AsgTpgAmY7PhCfg==";

describe("normaliseEtag", () => {
  it("drops the quotes S3 listings put around an etag", () => {
    expect(normaliseEtag(`"${EMPTY_MD5_HEX}"`)).toBe(EMPTY_MD5_HEX);
  });

  it("drops a weak marker and lower-cases, so equal etags compare equal", () => {
    expect(normaliseEtag(`W/"${EMPTY_MD5_HEX.toUpperCase()}"`)).toBe(
      EMPTY_MD5_HEX
    );
    expect(normaliseEtag(`"${EMPTY_MD5_HEX}-3"`)).toBe(`${EMPTY_MD5_HEX}-3`);
  });

  it("refuses an empty etag", () => {
    expect(() => normaliseEtag(`""`)).toThrow(/etag/);
  });
});

describe("contentMd5ForEtag", () => {
  it("turns a single-part upload's etag into the Content-MD5 header", () => {
    expect(contentMd5ForEtag(EMPTY_MD5_HEX)).toBe(EMPTY_MD5_BASE64);
    expect(contentMd5ForEtag(`"${EMPTY_MD5_HEX}"`)).toBe(EMPTY_MD5_BASE64);
  });

  it("is null for a multipart etag, which isn't the object's MD5", () => {
    expect(contentMd5ForEtag(`"${EMPTY_MD5_HEX}-3"`)).toBeNull();
  });

  it("is null for anything that isn't 32 hex digits", () => {
    expect(contentMd5ForEtag("abc")).toBeNull();
    expect(contentMd5ForEtag(`${EMPTY_MD5_HEX}00`)).toBeNull();
  });
});
