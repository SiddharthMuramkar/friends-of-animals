import { describe, expect, it } from "vitest";

import {
  deliveryDecision,
  dispositionFor,
  downloadFilenameFor,
} from "./delivery";
import { FILE_STATUSES } from "./file-status";

describe("deliveryDecision", () => {
  it("delivers a clean file to anyone the policy allows", () => {
    for (const isOwner of [true, false]) {
      expect(
        deliveryDecision({ status: "clean", isOwner, authorized: true })
      ).toEqual({ allow: true });
    }
  });

  it("refuses anyone the policy refuses, without saying why", () => {
    for (const status of FILE_STATUSES) {
      expect(
        deliveryDecision({ status, isOwner: false, authorized: false })
      ).toEqual({ allow: false, reason: "forbidden" });
    }
  });

  it("lets only the uploader open a file that hasn't been scanned yet", () => {
    for (const status of ["uploaded", "scanning"] as const) {
      expect(
        deliveryDecision({ status, isOwner: true, authorized: true })
      ).toEqual({ allow: true });
      expect(
        deliveryDecision({ status, isOwner: false, authorized: true })
      ).toEqual({ allow: false, reason: "file_not_ready" });
    }
  });

  it("has nothing to deliver before the upload finishes", () => {
    for (const isOwner of [true, false]) {
      expect(
        deliveryDecision({
          status: "pending_upload",
          isOwner,
          authorized: true,
        })
      ).toEqual({ allow: false, reason: "file_not_ready" });
    }
  });

  it("never delivers a quarantined, rejected or deleted file, even to its uploader or staff", () => {
    for (const status of ["quarantined", "rejected", "deleted"] as const) {
      for (const isOwner of [true, false]) {
        expect(deliveryDecision({ status, isOwner, authorized: true })).toEqual(
          { allow: false, reason: "file_unavailable" }
        );
      }
    }
  });
});

describe("dispositionFor", () => {
  it("shows images and PDFs in the browser and downloads anything else", () => {
    expect(dispositionFor("image/png")).toBe("inline");
    expect(dispositionFor("image/jpeg")).toBe("inline");
    expect(dispositionFor("image/webp")).toBe("inline");
    expect(dispositionFor("application/pdf")).toBe("inline");
    expect(dispositionFor("text/html")).toBe("attachment");
    expect(dispositionFor("image/svg+xml")).toBe("attachment");
  });
});

describe("downloadFilenameFor", () => {
  const fileId = "01938a00-1234-7abc-8def-0123456789ab";

  it("names the file after its purpose and id, never what the uploader called it", () => {
    expect(
      downloadFilenameFor({
        purpose: "test_upload",
        fileId,
        contentType: "image/png",
      })
    ).toBe("test_upload-01938a00.png");
    expect(
      downloadFilenameFor({
        purpose: "test_upload",
        fileId,
        contentType: "application/pdf",
      })
    ).toBe("test_upload-01938a00.pdf");
  });

  it("falls back to .bin for a type it doesn't know", () => {
    expect(
      downloadFilenameFor({
        purpose: "test_upload",
        fileId,
        contentType: "application/x-unknown",
      })
    ).toBe("test_upload-01938a00.bin");
  });
});
