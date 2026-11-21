import { describe, expect, it } from "vitest";

import {
  isPublicAssetPurpose,
  NotPublicAssetError,
  PUBLIC_ASSET_FALLBACK_PATH,
  PublicAssetBaseError,
  publicAssetBase,
  publicAssetUrl,
  storageKeyFromFallbackPath,
  storageKeyFromPublicAssetUrl,
} from "./public-asset-url";

const ID = "0193a1b2-c3d4-7e5f-8a6b-1c2d3e4f5a6b";
const STAMPED = {
  purpose: "stamped_gallery",
  storageKey: `pr-12/stamped_gallery/${ID}`,
};
const CDN = publicAssetBase({
  appEnv: "production",
  configured: "https://media.example.org/",
});
const FALLBACK = publicAssetBase({ appEnv: "preview", configured: undefined });

describe("isPublicAssetPurpose", () => {
  it("accepts only stamped purposes", () => {
    expect(isPublicAssetPurpose("stamped_gallery")).toBe(true);
    expect(isPublicAssetPurpose("stamped_social")).toBe(true);
    expect(isPublicAssetPurpose("entry_image")).toBe(false);
    expect(isPublicAssetPurpose("certificate_share")).toBe(false);
    expect(isPublicAssetPurpose("stamped_")).toBe(false);
    expect(isPublicAssetPurpose("STAMPED_gallery")).toBe(false);
  });
});

describe("publicAssetBase", () => {
  it("uses the configured CDN origin, without a trailing slash", () => {
    expect(CDN).toEqual({ kind: "cdn", origin: "https://media.example.org" });
    expect(
      publicAssetBase({
        appEnv: "staging",
        configured: "https://cdn.example.org/staging-assets/",
      })
    ).toEqual({
      kind: "cdn",
      origin: "https://cdn.example.org/staging-assets",
    });
  });

  it("falls back to the app's own route outside production", () => {
    for (const appEnv of ["local", "preview", "staging"] as const) {
      expect(publicAssetBase({ appEnv, configured: undefined })).toEqual({
        kind: "fallback",
      });
      expect(publicAssetBase({ appEnv, configured: "" })).toEqual({
        kind: "fallback",
      });
    }
  });

  it("fails closed in production without a CDN origin", () => {
    expect(() =>
      publicAssetBase({ appEnv: "production", configured: undefined })
    ).toThrow(PublicAssetBaseError);
  });

  it.each([
    "http://media.example.org",
    "https://user:pw@media.example.org",
    "https://media.example.org/?v=1",
    "https://media.example.org/#x",
    "not a url",
    "/media/p",
  ])("refuses %s", (configured) => {
    expect(() => publicAssetBase({ appEnv: "staging", configured })).toThrow(
      PublicAssetBaseError
    );
  });

  it("allows plain http for a local CDN only", () => {
    expect(
      publicAssetBase({ appEnv: "local", configured: "http://localhost:9000" })
    ).toEqual({ kind: "cdn", origin: "http://localhost:9000" });
    expect(() =>
      publicAssetBase({
        appEnv: "preview",
        configured: "http://localhost:9000",
      })
    ).toThrow(PublicAssetBaseError);
  });
});

describe("publicAssetUrl", () => {
  it("puts a stamped file under the CDN origin", () => {
    expect(publicAssetUrl(CDN, STAMPED)).toBe(
      `https://media.example.org/pr-12/stamped_gallery/${ID}`
    );
  });

  it("puts a stamped file under the fallback route", () => {
    expect(PUBLIC_ASSET_FALLBACK_PATH).toBe("/media/p");
    expect(publicAssetUrl(FALLBACK, STAMPED)).toBe(
      `/media/p/pr-12/stamped_gallery/${ID}`
    );
    expect(
      publicAssetUrl(FALLBACK, {
        purpose: "stamped_social",
        storageKey: `stamped_social/${ID}`,
      })
    ).toBe(`/media/p/stamped_social/${ID}`);
  });

  it("refuses every purpose that isn't stamped", () => {
    for (const purpose of ["entry_image", "certificate_share", "test_upload"]) {
      expect(() =>
        publicAssetUrl(CDN, { purpose, storageKey: `pr-12/${purpose}/${ID}` })
      ).toThrow(NotPublicAssetError);
    }
  });

  it.each([
    ["an original's key under a stamped purpose", `pr-12/entry_image/${ID}`],
    ["a quarantined key", `pr-12/quarantine/${ID}`],
    ["a key without a file id", "pr-12/stamped_gallery/cat.jpg"],
    ["a traversal", `pr-12/../stamped_gallery/${ID}`],
    ["two prefixes", `a/b/stamped_gallery/${ID}`],
    ["an upper-case prefix", `PR-12/stamped_gallery/${ID}`],
    ["a leading slash", `/stamped_gallery/${ID}`],
  ])("refuses %s", (_, storageKey) => {
    expect(() =>
      publicAssetUrl(CDN, { purpose: "stamped_gallery", storageKey })
    ).toThrow(NotPublicAssetError);
  });
});

describe("storageKeyFromPublicAssetUrl", () => {
  it("reads the key back from either kind of URL", () => {
    expect(
      storageKeyFromPublicAssetUrl(CDN, publicAssetUrl(CDN, STAMPED))
    ).toBe(STAMPED.storageKey);
    expect(
      storageKeyFromPublicAssetUrl(FALLBACK, publicAssetUrl(FALLBACK, STAMPED))
    ).toBe(STAMPED.storageKey);
  });

  it.each([
    `https://other.example.org/pr-12/stamped_gallery/${ID}`,
    `https://media.example.org/pr-12/entry_image/${ID}`,
    `https://media.example.org/pr-12/stamped_gallery/${ID}?x=1`,
    `/api/files/${ID}`,
    "",
  ])("returns null for %s", (url) => {
    expect(storageKeyFromPublicAssetUrl(CDN, url)).toBeNull();
  });
});

describe("storageKeyFromFallbackPath", () => {
  it("joins the route's segments into a stamped key", () => {
    expect(storageKeyFromFallbackPath(["pr-12", "stamped_gallery", ID])).toBe(
      `pr-12/stamped_gallery/${ID}`
    );
    expect(storageKeyFromFallbackPath(["stamped_social", ID])).toBe(
      `stamped_social/${ID}`
    );
  });

  it.each([
    [["pr-12", "entry_image", ID]],
    [["pr-12", "quarantine", ID]],
    [["..", "stamped_gallery", ID]],
    [["pr-12", "stamped_gallery", "..", ID]],
    [["pr-12", "stamped_gallery/x", ID]],
    [["pr-12", "stamped_gallery", ""]],
    [["pr-12", "stamped_gallery", `${ID}.jpg`]],
    [[ID]],
    [[]],
  ])("refuses %j", (segments) => {
    expect(storageKeyFromFallbackPath(segments)).toBeNull();
  });
});
