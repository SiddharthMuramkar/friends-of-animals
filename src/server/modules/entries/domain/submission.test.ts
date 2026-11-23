import { describe, expect, it } from "vitest";

import type { EntryFileStatus, EntryStatus } from "./status";
import {
  decideFileOutcome,
  decideUpload,
  windowState,
  type EntrySnapshot,
} from "./submission";

const WINDOW = {
  opensAt: new Date("2027-01-10T00:00:00.000Z"),
  closesAt: new Date("2027-01-31T18:29:59.000Z"),
};
const DURING = new Date("2027-01-15T04:30:00.000Z");

function entry(
  status: EntryStatus,
  files: Array<[string, EntryFileStatus]>
): EntrySnapshot {
  return {
    status,
    files: files.map(([id, fileStatus]) => ({ id, status: fileStatus })),
  };
}

describe("windowState", () => {
  it("is open from the opening instant up to, not including, the deadline", () => {
    expect(windowState(WINDOW, new Date("2027-01-09T23:59:59.999Z"))).toBe(
      "not_open"
    );
    expect(windowState(WINDOW, WINDOW.opensAt)).toBe("open");
    expect(windowState(WINDOW, new Date("2027-01-31T18:29:58.999Z"))).toBe(
      "open"
    );
    expect(windowState(WINDOW, WINDOW.closesAt)).toBe("closed");
  });
});

describe("decideUpload", () => {
  it("creates the entry on a registration's first upload", () => {
    expect(decideUpload({ entry: null, window: WINDOW, now: DURING })).toEqual({
      ok: true,
      action: "create",
      supersede: [],
    });
  });

  it("retries a rejected or failed entry", () => {
    for (const status of ["rejected", "failed"] as const) {
      expect(
        decideUpload({
          entry: entry(status, [["a", status]]),
          window: WINDOW,
          now: DURING,
        })
      ).toEqual({ ok: true, action: "retry", supersede: [] });
    }
  });

  it("replaces a submitted entry's file, keeping the live one", () => {
    expect(
      decideUpload({
        entry: entry("submitted", [
          ["a", "superseded"],
          ["b", "live"],
        ]),
        window: WINDOW,
        now: DURING,
      })
    ).toEqual({ ok: true, action: "replace", supersede: [] });
  });

  it("drops uploads still being checked when a newer one arrives", () => {
    expect(
      decideUpload({
        entry: entry("submitted", [
          ["a", "live"],
          ["b", "pending"],
          ["c", "processing"],
          ["d", "failed"],
        ]),
        window: WINDOW,
        now: DURING,
      })
    ).toEqual({ ok: true, action: "replace", supersede: ["b", "c"] });
    expect(
      decideUpload({
        entry: entry("processing", [["a", "pending"]]),
        window: WINDOW,
        now: DURING,
      })
    ).toEqual({ ok: true, action: "replace", supersede: ["a"] });
  });

  it("refuses every upload before the window opens or once the deadline passes", () => {
    const entries = [
      null,
      entry("submitted", [["a", "live"]]),
      entry("rejected", [["a", "rejected"]]),
    ];
    for (const current of entries) {
      expect(
        decideUpload({
          entry: current,
          window: WINDOW,
          now: new Date("2027-01-09T12:00:00.000Z"),
        })
      ).toEqual({ ok: false, reason: "submission_not_open" });
      expect(
        decideUpload({ entry: current, window: WINDOW, now: WINDOW.closesAt })
      ).toEqual({ ok: false, reason: "deadline_passed" });
    }
  });

  it("refuses an entry that has moved on from submission", () => {
    for (const status of [
      "school_shortlisted",
      "not_shortlisted",
      "submitted_to_foa",
      "foa_verified",
      "sent_back",
    ] as const) {
      expect(
        decideUpload({
          entry: entry(status, [["a", "live"]]),
          window: WINDOW,
          now: DURING,
        })
      ).toEqual({ ok: false, reason: "entry_locked" });
    }
  });
});

describe("decideFileOutcome", () => {
  it("moves a clean upload on to processing and leaves the entry alone", () => {
    expect(
      decideFileOutcome(
        entry("processing", [["a", "pending"]]),
        "a",
        "scan_clean"
      )
    ).toEqual({
      applies: true,
      file: "processing",
      entry: null,
      supersede: [],
      event: null,
    });
  });

  it("submits the entry when its first file goes live", () => {
    expect(
      decideFileOutcome(
        entry("processing", [["a", "processing"]]),
        "a",
        "processed"
      )
    ).toEqual({
      applies: true,
      file: "live",
      entry: "submitted",
      supersede: [],
      event: "entry.submitted",
    });
  });

  it("rejects the entry when its first file is infected", () => {
    expect(
      decideFileOutcome(
        entry("processing", [["a", "pending"]]),
        "a",
        "scan_infected"
      )
    ).toEqual({
      applies: true,
      file: "rejected",
      entry: "rejected",
      supersede: [],
      event: "entry.rejected",
    });
  });

  it("fails the entry when its first file can't be processed", () => {
    expect(
      decideFileOutcome(
        entry("processing", [["a", "processing"]]),
        "a",
        "processing_failed"
      )
    ).toEqual({
      applies: true,
      file: "failed",
      entry: "failed",
      supersede: [],
      event: "entry.failed",
    });
  });

  it("swaps in a replacement once it is live, superseding the old file", () => {
    expect(
      decideFileOutcome(
        entry("submitted", [
          ["a", "live"],
          ["b", "processing"],
        ]),
        "b",
        "processed"
      )
    ).toEqual({
      applies: true,
      file: "live",
      entry: null,
      supersede: ["a"],
      event: "entry.replacement_live",
    });
  });

  it("keeps the old file live when a replacement is infected or fails", () => {
    const current = entry("submitted", [
      ["a", "live"],
      ["b", "pending"],
      ["c", "processing"],
    ]);
    expect(decideFileOutcome(current, "b", "scan_infected")).toEqual({
      applies: true,
      file: "rejected",
      entry: null,
      supersede: [],
      event: "entry.replacement_rejected",
    });
    expect(decideFileOutcome(current, "c", "processing_failed")).toEqual({
      applies: true,
      file: "failed",
      entry: null,
      supersede: [],
      event: "entry.replacement_failed",
    });
  });

  it("ignores an outcome for a dropped, unknown or already settled file", () => {
    const current = entry("submitted", [
      ["a", "live"],
      ["b", "superseded"],
      ["c", "rejected"],
    ]);
    expect(decideFileOutcome(current, "b", "processed")).toEqual({
      applies: false,
    });
    expect(decideFileOutcome(current, "zz", "scan_clean")).toEqual({
      applies: false,
    });
    expect(decideFileOutcome(current, "a", "processed")).toEqual({
      applies: false,
    });
    expect(decideFileOutcome(current, "c", "scan_infected")).toEqual({
      applies: false,
    });
  });

  it("ignores an outcome that skips a step", () => {
    expect(
      decideFileOutcome(
        entry("processing", [["a", "pending"]]),
        "a",
        "processed"
      )
    ).toEqual({ applies: false });
    expect(
      decideFileOutcome(
        entry("processing", [["a", "processing"]]),
        "a",
        "scan_infected"
      )
    ).toEqual({ applies: false });
  });
});
