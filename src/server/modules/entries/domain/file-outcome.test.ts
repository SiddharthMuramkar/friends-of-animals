import { describe, expect, it } from "vitest";

import { outcomesOf } from "./file-outcome";

describe("outcomesOf", () => {
  it.each([
    [{ status: "pending_upload", processing: null }, []],
    [{ status: "uploaded", processing: null }, []],
    [{ status: "scanning", processing: null }, []],
    [{ status: "quarantined", processing: null }, ["scan_infected"]],
    // Bytes that aren't the declared picture can't be opened as one.
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
    // Clean with no media job: nothing has made its copies yet.
    [{ status: "clean", processing: null }, ["scan_clean"]],
    [{ status: "deleted", processing: null }, []],
  ] as const)("reads %j as every outcome so far: %j", (file, outcomes) => {
    expect(outcomesOf(file)).toEqual(outcomes);
  });
});
