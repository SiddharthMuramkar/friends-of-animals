import { describe, expect, it } from "vitest";

import {
  POLL_INTERVAL_MS,
  POLL_LIMIT_MS,
  downloadPathFor,
  messageKeyFor,
  nextPollDelay,
  phaseForStatus,
  putHeaders,
  typeNameKeys,
} from "./upload";

describe("putHeaders", () => {
  it("sends exactly the headers the upload URL was signed with", () => {
    expect(putHeaders({ "Content-Type": "image/png" })).toEqual({
      "Content-Type": "image/png",
    });
  });

  it("leaves out the ones a browser sets itself, whatever their case", () => {
    expect(
      putHeaders({
        "Content-Type": "application/pdf",
        "content-length": "1234",
        Host: "storage.example",
      })
    ).toEqual({ "Content-Type": "application/pdf" });
  });
});

describe("nextPollDelay", () => {
  it("asks again every 2 seconds", () => {
    expect(POLL_INTERVAL_MS).toBe(2_000);
    expect(nextPollDelay(0)).toBe(2_000);
    expect(nextPollDelay(10_000)).toBe(2_000);
  });

  it("stops once a minute has passed, never waiting past it", () => {
    expect(POLL_LIMIT_MS).toBe(60_000);
    expect(nextPollDelay(59_000)).toBe(1_000);
    expect(nextPollDelay(60_000)).toBeNull();
    expect(nextPollDelay(75_000)).toBeNull();
  });
});

describe("phaseForStatus", () => {
  it.each([
    ["pending_upload", "uploading"],
    ["uploaded", "checking"],
    ["scanning", "checking"],
    ["clean", "ready"],
    ["quarantined", "unavailable"],
    ["rejected", "unavailable"],
    ["deleted", "unavailable"],
  ] as const)("shows a %s file as %s", (status, phase) => {
    expect(phaseForStatus(status)).toBe(phase);
  });
});

describe("downloadPathFor", () => {
  it("is the file's delivery route", () => {
    expect(downloadPathFor("01938a00-0000-7000-8000-000000000201")).toBe(
      "/api/files/01938a00-0000-7000-8000-000000000201"
    );
  });

  it("refuses anything but a file id", () => {
    expect(() => downloadPathFor("../account")).toThrow();
  });
});

describe("typeNameKeys", () => {
  it("names each type the demo upload takes, in order", () => {
    expect(
      typeNameKeys(["image/png", "image/jpeg", "image/webp", "application/pdf"])
    ).toEqual(["png", "jpeg", "webp", "pdf"]);
  });
});

describe("messageKeyFor", () => {
  it.each([
    ["signed_out", "signedOut"],
    ["too_large", "tooLarge"],
    ["empty", "empty"],
    ["type_not_allowed", "typeNotAllowed"],
    ["purpose_unavailable", "switchedOff"],
    ["upload_missing", "uploadFailed"],
    ["upload_rejected", "uploadRejected"],
    ["unknown", "unknown"],
  ] as const)("words %s with files.errors.%s", (error, key) => {
    expect(messageKeyFor(error)).toBe(key);
  });
});
