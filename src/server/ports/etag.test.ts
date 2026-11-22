import { describe, expect, it } from "vitest";

import { normaliseEtag } from "./etag";

// MD5 of the empty string (RFC 1321 test suite).
const EMPTY_MD5_HEX = "d41d8cd98f00b204e9800998ecf8427e";

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
