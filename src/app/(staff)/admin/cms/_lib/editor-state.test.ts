import { describe, expect, it } from "vitest";

import { afterSave, noticeOf } from "./editor-state";

const SOURCE = "## Who we are\n\nWe run art competitions.";

describe("afterSave", () => {
  it("puts the source back with its line errors when it doesn't parse", () => {
    expect(
      afterSave(
        { ok: false, errors: [{ line: 3, code: "empty_section" }] },
        SOURCE
      )
    ).toEqual({
      source: SOURCE,
      sourceErrors: [{ line: 3, code: "empty_section" }],
    });
  });

  it("names the kind's issues as a body error", () => {
    expect(
      afterSave(
        { ok: false, error: "invalid_body", issues: ["sections: Too small"] },
        SOURCE
      )
    ).toEqual({ source: SOURCE, alert: "invalidBody" });
  });

  it("calls anything else a failure the form can't point at", () => {
    const refusals: Parameters<typeof afterSave>[0][] = [
      { ok: false, error: "invalid_input", fields: ["key"] },
      { ok: false, error: "not_editable" },
    ];
    for (const result of refusals) {
      expect(afterSave(result, SOURCE)).toEqual({
        source: SOURCE,
        alert: "failed",
      });
    }
  });
});

describe("noticeOf", () => {
  it("reads a save, a publish and a refusal from the redirect", () => {
    expect(noticeOf({ saved: "lzx1" })).toEqual({ kind: "saved", key: "lzx1" });
    expect(noticeOf({ published: "3-lzx1" })).toEqual({
      kind: "published",
      version: 3,
      key: "3-lzx1",
    });
    expect(noticeOf({ refused: "not_draft" })).toEqual({
      kind: "refused",
      reason: "not_draft",
    });
  });

  it("ignores anything it doesn't recognise", () => {
    expect(noticeOf({})).toBeNull();
    expect(noticeOf({ published: "three" })).toBeNull();
    expect(noticeOf({ refused: "<script>" })).toBeNull();
    expect(noticeOf({ saved: ["a", "b"] })).toBeNull();
  });
});
