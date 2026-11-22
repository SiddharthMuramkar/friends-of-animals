import { describe, expect, it } from "vitest";

import {
  isDatabaseGone,
  planPreviewChanges,
  previewDatabasesToServe,
} from "./preview-databases";

describe("previewDatabasesToServe", () => {
  it("serves PR and branch previews labelled by their build", () => {
    expect(
      previewDatabasesToServe([
        { datname: "foa_pr_12", comment: "foa-preview pr=12" },
        {
          datname: "foa_br_ticket_61_outbox_1a2b3c4d",
          comment: "foa-preview branch=ticket/61-outbox",
        },
      ])
    ).toEqual(["foa_br_ticket_61_outbox_1a2b3c4d", "foa_pr_12"]);
  });

  it("serves a PR's databases named with a migrations fingerprint", () => {
    // A PR whose migrations changed keeps its older database until it
    // closes; the sweeper drops them together, so both are served.
    expect(
      previewDatabasesToServe([
        { datname: "foa_pr_143_0a1b2c3d", comment: "foa-preview pr=143" },
        { datname: "foa_pr_143_9f8e7d6c", comment: "foa-preview pr=143" },
        {
          datname: "foa_br_ticket_61_outbox_1a2b3c4d_0a1b2c3d",
          comment: "foa-preview branch=ticket/61-outbox",
        },
      ])
    ).toEqual([
      "foa_br_ticket_61_outbox_1a2b3c4d_0a1b2c3d",
      "foa_pr_143_0a1b2c3d",
      "foa_pr_143_9f8e7d6c",
    ]);
  });

  it("skips a fingerprinted name whose PR number isn't the label's", () => {
    expect(
      previewDatabasesToServe([
        { datname: "foa_pr_1430_0a1b2c3d", comment: "foa-preview pr=143" },
        { datname: "foa_pr_14_30a1b2c3d", comment: "foa-preview pr=14" },
        { datname: "foa_pr_143_0a1b2c3", comment: "foa-preview pr=143" },
        { datname: "foa_pr_143_0a1b2c3d_x", comment: "foa-preview pr=143" },
      ])
    ).toEqual([]);
  });

  it("never serves the shared databases, templates or unlabelled ones", () => {
    expect(
      previewDatabasesToServe([
        { datname: "postgres", comment: null },
        { datname: "template0", comment: null },
        { datname: "template1", comment: null },
        { datname: "foa_seed", comment: "foa-preview pr=1" },
        { datname: "foa_staging", comment: "foa-preview pr=1" },
        { datname: "foa", comment: null },
        { datname: "foa_pr_7", comment: null },
        { datname: "foa_pr_8", comment: "" },
        { datname: "foa_pr_9", comment: "preview pr=9" },
      ])
    ).toEqual([]);
  });

  it("skips a database whose name and label disagree", () => {
    expect(
      previewDatabasesToServe([
        { datname: "foa_pr_12", comment: "foa-preview pr=13" },
        { datname: "foa_pr_14", comment: "foa-preview branch=main" },
        { datname: "foa_br_main_0a1b2c3d", comment: "foa-preview pr=15" },
        { datname: "foa_pr_016", comment: "foa-preview pr=16" },
      ])
    ).toEqual([]);
  });

  it("skips names and labels the sweeper wouldn't recognise", () => {
    expect(
      previewDatabasesToServe([
        { datname: "FOA_PR_3", comment: "foa-preview pr=3" },
        { datname: "foa_pr_4; drop", comment: "foa-preview pr=4" },
        {
          datname: `foa_br_${"a".repeat(57)}`,
          comment: "foa-preview branch=a",
        },
        { datname: "foa_br_x_0a1b2c3d", comment: "foa-preview branch=-x" },
        { datname: "foa_br_y_0a1b2c3d", comment: "foa-preview branch=y z" },
        { datname: "foa_pr_5", comment: "foa-preview pr=5 " },
      ])
    ).toEqual([]);
  });

  it("lists each database once, in name order", () => {
    expect(
      previewDatabasesToServe([
        { datname: "foa_pr_30", comment: "foa-preview pr=30" },
        { datname: "foa_pr_4", comment: "foa-preview pr=4" },
        { datname: "foa_pr_30", comment: "foa-preview pr=30" },
      ])
    ).toEqual(["foa_pr_30", "foa_pr_4"]);
  });
});

describe("planPreviewChanges", () => {
  it("attaches new previews and detaches the ones that went away", () => {
    expect(
      planPreviewChanges(new Set(["foa_pr_1", "foa_pr_2"]), [
        "foa_pr_2",
        "foa_pr_3",
      ])
    ).toEqual({ attach: ["foa_pr_3"], detach: ["foa_pr_1"] });
  });

  it("changes nothing when the same previews are still there", () => {
    expect(planPreviewChanges(["foa_pr_1"], ["foa_pr_1"])).toEqual({
      attach: [],
      detach: [],
    });
  });

  it("detaches everything when no preview is left", () => {
    expect(planPreviewChanges(["foa_pr_9", "foa_pr_10"], [])).toEqual({
      attach: [],
      detach: ["foa_pr_10", "foa_pr_9"],
    });
  });
});

describe("isDatabaseGone", () => {
  const withCode = (code: string) =>
    Object.assign(new Error("database error"), { code });

  it("is true when Postgres says the database doesn't exist", () => {
    expect(isDatabaseGone(withCode("3D000"))).toBe(true);
  });

  it("looks through wrapped errors, as Drizzle wraps driver errors", () => {
    const wrapped = new Error("Failed query", { cause: withCode("3D000") });
    expect(isDatabaseGone(wrapped)).toBe(true);
  });

  it("is false for other failures, which are retried instead", () => {
    expect(isDatabaseGone(withCode("57P01"))).toBe(false);
    expect(isDatabaseGone(withCode("08006"))).toBe(false);
    expect(isDatabaseGone(new Error("connect ECONNREFUSED"))).toBe(false);
    expect(isDatabaseGone("3D000")).toBe(false);
    expect(isDatabaseGone(undefined)).toBe(false);
  });
});
