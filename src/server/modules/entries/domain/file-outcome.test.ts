import { describe, expect, it } from "vitest";

import { outcomesOf } from "./file-outcome";

describe("outcomesOf", () => {
  it.each([
    [{ status: "pending_upload", processing: null }, []],
    [{ status: "uploaded", processing: null }, []],
    [{ status: "scanning", processing: null }, []],
    [{ status: "quarantined", processing: null }, ["scan_infected"]],
    // Bytes that aren't the declared type can't be opened as it.
    [
      { status: "rejected", processing: null },
      ["scan_clean", "processing_failed"],
    ],
    [{ status: "clean", processing: "queued" }, ["scan_clean"]],
    [{ status: "clean", processing: "done" }, ["scan_clean", "processed"]],
    [
      { status: "clean", processing: "failed" },
      ["scan_clean", "processing_failed"],
    ],
    // Clean, its media job not queued yet: nothing has made its copies.
    [{ status: "clean", processing: null }, ["scan_clean"]],
    [{ status: "deleted", processing: null }, []],
  ] as const)(
    "reads %j, with a media job, as every outcome so far: %j",
    (file, outcomes) => {
      expect(outcomesOf({ ...file, hasMediaJob: true })).toEqual(outcomes);
    }
  );

  it("reads a clean file with no media job as ready: an essay's PDF (#86)", () => {
    expect(
      outcomesOf({ status: "clean", processing: null, hasMediaJob: false })
    ).toEqual(["scan_clean", "processed"]);
    expect(
      outcomesOf({ status: "scanning", processing: null, hasMediaJob: false })
    ).toEqual([]);
    expect(
      outcomesOf({
        status: "quarantined",
        processing: null,
        hasMediaJob: false,
      })
    ).toEqual(["scan_infected"]);
  });
});
