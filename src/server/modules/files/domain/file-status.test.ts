import { describe, expect, it } from "vitest";

import { FILE_STATUSES, nextFileStatus, type FileEvent } from "./file-status";

describe("nextFileStatus", () => {
  it("walks an upload from presign to clean", () => {
    const events: FileEvent[] = [
      "upload_confirmed",
      "scan_started",
      "scan_passed",
    ];
    const visited = events.reduce<string[]>(
      (path, event) => {
        const next = nextFileStatus(path.at(-1) as never, event);
        if (next === null) throw new Error(`refused ${event}`);
        return [...path, next];
      },
      ["pending_upload"]
    );
    expect(visited).toEqual([
      "pending_upload",
      "uploaded",
      "scanning",
      "clean",
    ]);
  });

  it("quarantines a file the scanner flags", () => {
    expect(nextFileStatus("scanning", "scan_found_malware")).toBe(
      "quarantined"
    );
  });

  it("rejects a file whose bytes don't match its declaration", () => {
    expect(nextFileStatus("pending_upload", "upload_rejected")).toBe(
      "rejected"
    );
    expect(nextFileStatus("scanning", "scan_rejected")).toBe("rejected");
  });

  it("lets a scan start again on a retry", () => {
    expect(nextFileStatus("scanning", "scan_started")).toBe("scanning");
  });

  it("never brings a quarantined, rejected or deleted file back", () => {
    for (const from of ["quarantined", "rejected", "deleted"] as const) {
      for (const event of [
        "upload_confirmed",
        "scan_started",
        "scan_passed",
      ] as const) {
        expect(nextFileStatus(from, event)).toBeNull();
      }
    }
  });

  it("never marks a file clean without a scan", () => {
    for (const from of FILE_STATUSES) {
      if (from === "scanning") continue;
      expect(nextFileStatus(from, "scan_passed")).toBeNull();
    }
  });

  it("deletes from every state but deleted", () => {
    for (const from of FILE_STATUSES) {
      expect(nextFileStatus(from, "deleted")).toBe(
        from === "deleted" ? null : "deleted"
      );
    }
  });
});
