import { describe, expect, it } from "vitest";

import {
  nonProductionPrefixOf,
  offsiteKeyFor,
  sourceOfOffsiteKey,
} from "./keys";

describe("offsiteKeyFor", () => {
  it("files a source object under its bucket's name in B2", () => {
    expect(
      offsiteKeyFor({
        bucket: "foa-private",
        key: "general/01890a5d-ac96-774b-bcce-b302099a8057",
      })
    ).toBe("foa-private/general/01890a5d-ac96-774b-bcce-b302099a8057");
  });

  it("refuses a bucket name R2 wouldn't accept", () => {
    for (const bucket of [
      "",
      "ab",
      "Foa-Private",
      "foa_private",
      "-foa",
      "foa/x",
    ]) {
      expect(() => offsiteKeyFor({ bucket, key: "general/a" })).toThrow(
        /bucket/
      );
    }
  });

  it("refuses an empty key, a key starting with a slash, and one B2 can't hold", () => {
    for (const key of ["", "/general/a", "x".repeat(1024)]) {
      expect(() => offsiteKeyFor({ bucket: "foa-private", key })).toThrow(
        /key/
      );
    }
  });
});

describe("sourceOfOffsiteKey", () => {
  it("finds the bucket and key a copy came from", () => {
    expect(sourceOfOffsiteKey("foa-public/gallery/2027/x.webp")).toEqual({
      bucket: "foa-public",
      key: "gallery/2027/x.webp",
    });
  });

  it("is null for anything offsiteKeyFor can't have made", () => {
    for (const offsiteKey of [
      "",
      "foa-private",
      "foa-private/",
      "ab/x",
      "/x",
    ]) {
      expect(sourceOfOffsiteKey(offsiteKey)).toBeNull();
    }
  });
});

describe("nonProductionPrefixOf", () => {
  it("names the environment prefix of a staging, local or preview key", () => {
    expect(nonProductionPrefixOf("staging/general/a")).toBe("staging/");
    expect(nonProductionPrefixOf("local/general/a")).toBe("local/");
    expect(nonProductionPrefixOf("pr-12/test_upload/a")).toBe("pr-12/");
    expect(nonProductionPrefixOf("br-1a2b3c4d/general/a")).toBe("br-1a2b3c4d/");
  });

  it("is null for a production key, which has no prefix", () => {
    for (const key of [
      "general/01890a5d-ac96-774b-bcce-b302099a8057",
      "quarantine/01890a5d-ac96-774b-bcce-b302099a8057",
      "stagingarea/x",
      "pr-/x",
      "br-xyz/x",
    ]) {
      expect(nonProductionPrefixOf(key)).toBeNull();
    }
  });
});
