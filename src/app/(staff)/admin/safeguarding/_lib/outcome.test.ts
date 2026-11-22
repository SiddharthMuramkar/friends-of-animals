import { describe, expect, it } from "vitest";

import {
  outcomeFromSearch,
  outcomeHref,
  outcomeOfAssign,
  outcomeOfMove,
  outcomeOfNote,
} from "./outcome";

const REPORT = "01938a00-0000-7000-8000-000000000001";

describe("outcomeOf…", () => {
  it("says where a move took the report", () => {
    expect(outcomeOfMove({ ok: true, status: "triaged" })).toEqual({
      kind: "result",
      key: "moved",
      status: "triaged",
    });
  });

  it("tells a changed assignment from an unchanged one", () => {
    expect(outcomeOfAssign({ ok: true, changed: true })).toEqual({
      kind: "result",
      key: "assigned",
    });
    expect(outcomeOfAssign({ ok: true, changed: false })).toEqual({
      kind: "result",
      key: "unchanged",
    });
  });

  it("confirms a note", () => {
    expect(outcomeOfNote({ ok: true, entryId: REPORT })).toEqual({
      kind: "result",
      key: "noted",
    });
  });

  it("passes refusals on by their code", () => {
    expect(
      outcomeOfMove({ ok: false, error: "transition_not_allowed" })
    ).toEqual({ kind: "error", key: "transition_not_allowed" });
    expect(outcomeOfAssign({ ok: false, error: "assignee_not_lead" })).toEqual({
      kind: "error",
      key: "assignee_not_lead",
    });
    expect(
      outcomeOfNote({ ok: false, error: "invalid_input", fields: ["body"] })
    ).toEqual({ kind: "error", key: "invalid_input" });
  });
});

describe("outcomeHref and outcomeFromSearch", () => {
  it("round-trip every outcome through the report page's address", () => {
    for (const outcome of [
      { kind: "result", key: "moved", status: "escalated" },
      { kind: "result", key: "assigned" },
      { kind: "result", key: "unchanged" },
      { kind: "result", key: "noted" },
      { kind: "error", key: "report_resolved" },
      { kind: "error", key: "not_found" },
    ] as const) {
      const url = new URL(outcomeHref(REPORT, outcome), "https://foa.test");
      expect(url.pathname).toBe(`/admin/safeguarding/${REPORT}`);
      expect(outcomeFromSearch(Object.fromEntries(url.searchParams))).toEqual(
        outcome
      );
    }
  });

  it("ignores anything it didn't write, so a link can't put words on the page", () => {
    expect(outcomeFromSearch({})).toBeNull();
    expect(outcomeFromSearch({ result: "hacked" })).toBeNull();
    expect(outcomeFromSearch({ error: "<script>" })).toBeNull();
    expect(outcomeFromSearch({ result: "moved", status: "gone" })).toBeNull();
    expect(outcomeFromSearch({ result: ["moved", "noted"] })).toBeNull();
  });
});
