import { describe, expect, it } from "vitest";

import {
  derivativeKeyFor,
  derivativeKindsFor,
  mediaJobFor,
} from "./media-work";
import { storagePrefixOf } from "./storage-key";

const FILE_ID = "01938a00-0000-7000-8000-000000000001";

describe("derivativeKindsFor", () => {
  it.each([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ])(
    "makes a thumbnail and a display copy of a test upload of %s",
    (contentType) => {
      expect(
        derivativeKindsFor({ purpose: "test_upload", contentType })
      ).toEqual(["thumb_320", "display_1600"]);
    }
  );

  it("reads the type as stored, whatever its case and spacing", () => {
    expect(
      derivativeKindsFor({
        purpose: "test_upload",
        contentType: " Image/JPEG ",
      })
    ).toEqual(["thumb_320", "display_1600"]);
  });

  it.each(["application/pdf", "image/gif", "image/svg+xml", "text/html"])(
    "makes nothing of %s",
    (contentType) => {
      expect(
        derivativeKindsFor({ purpose: "test_upload", contentType })
      ).toEqual([]);
    }
  );

  it("makes nothing for a purpose that registered no derivatives", () => {
    expect(
      derivativeKindsFor({
        purpose: "not_registered" as "test_upload",
        contentType: "image/jpeg",
      })
    ).toEqual([]);
  });
});

describe("derivativeKeyFor", () => {
  it("keeps a file's derivatives in one folder under its environment's prefix", () => {
    expect(
      derivativeKeyFor({ prefix: "pr-12/", fileId: FILE_ID, kind: "thumb_320" })
    ).toBe(`pr-12/derived/${FILE_ID}/thumb_320.webp`);
    expect(
      derivativeKeyFor({ prefix: "", fileId: FILE_ID, kind: "display_1600" })
    ).toBe(`derived/${FILE_ID}/display_1600.webp`);
  });

  it.each([
    ["a prefix that isn't one folder", { prefix: "../", fileId: FILE_ID }],
    ["a prefix with no slash", { prefix: "pr-12", fileId: FILE_ID }],
    ["an id that isn't a UUID", { prefix: "", fileId: "../../etc/passwd" }],
  ])("refuses %s", (_, input) => {
    expect(() => derivativeKeyFor({ ...input, kind: "thumb_320" })).toThrow();
  });
});

describe("storagePrefixOf", () => {
  it("reads the environment prefix from an original's key", () => {
    expect(
      storagePrefixOf({
        storageKey: `staging/test_upload/${FILE_ID}`,
        purpose: "test_upload",
        id: FILE_ID,
      })
    ).toBe("staging/");
    expect(
      storagePrefixOf({
        storageKey: `test_upload/${FILE_ID}`,
        purpose: "test_upload",
        id: FILE_ID,
      })
    ).toBe("");
  });

  it("refuses a key that isn't the file's own", () => {
    expect(() =>
      storagePrefixOf({
        storageKey: `staging/quarantine/${FILE_ID}`,
        purpose: "test_upload",
        id: FILE_ID,
      })
    ).toThrow();
  });
});

describe("essay PDF derivatives", () => {
  it("queues PDF work only for essay documents and uses the PDF extension", () => {
    expect(
      mediaJobFor({ purpose: "entry_document", contentType: "application/pdf" })
    ).toBe("pdf");
    expect(
      mediaJobFor({ purpose: "consent_form", contentType: "application/pdf" })
    ).toBeNull();
    expect(
      mediaJobFor({ purpose: "entry_document", contentType: "image/webp" })
    ).toBeNull();
    expect(
      derivativeKeyFor({ prefix: "local/", fileId: FILE_ID, kind: "pdf_clean" })
    ).toBe(`local/derived/${FILE_ID}/pdf_clean.pdf`);
  });
});
