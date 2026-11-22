import { describe, expect, it } from "vitest";

import {
  CONTACT_CLOSE_REASONS,
  CONTACT_MESSAGE_STATUSES,
  decideAssignment,
  decideStatusChange,
} from "./status";

describe("contact message status transitions", () => {
  // Every status against every target: the pairs not listed are refused,
  // and a status to itself changes nothing.
  const allowed = new Set([
    "new in_progress",
    "new closed",
    "in_progress closed",
    "closed in_progress",
  ]);

  const table = CONTACT_MESSAGE_STATUSES.flatMap((from) =>
    CONTACT_MESSAGE_STATUSES.map((to) => ({ from, to }))
  );

  it("covers three statuses and four close reasons", () => {
    expect(CONTACT_MESSAGE_STATUSES).toEqual(["new", "in_progress", "closed"]);
    expect(CONTACT_CLOSE_REASONS).toEqual([
      "resolved",
      "no_action_needed",
      "spam",
      "duplicate",
    ]);
    expect(table).toHaveLength(9);
  });

  it.each(table)("$from -> $to", ({ from, to }) => {
    const result = decideStatusChange({
      from,
      to,
      ...(to === "closed" ? { closeReason: "resolved" } : {}),
    });
    if (from === to) {
      expect(result).toEqual({ ok: true, changed: false });
    } else if (allowed.has(`${from} ${to}`)) {
      expect(result).toMatchObject({ ok: true, changed: true, to });
    } else {
      expect(result).toEqual({ ok: false, error: "transition_not_allowed" });
    }
  });

  it("refuses going back to new", () => {
    expect(decideStatusChange({ from: "closed", to: "new" })).toEqual({
      ok: false,
      error: "transition_not_allowed",
    });
    expect(decideStatusChange({ from: "in_progress", to: "new" })).toEqual({
      ok: false,
      error: "transition_not_allowed",
    });
  });

  it("needs a reason to close, and keeps it", () => {
    expect(decideStatusChange({ from: "new", to: "closed" })).toEqual({
      ok: false,
      error: "close_reason_required",
    });
    expect(
      decideStatusChange({ from: "new", to: "closed", closeReason: "spam" })
    ).toEqual({
      ok: true,
      changed: true,
      to: "closed",
      closeReason: "spam",
    });
  });

  it("refuses a close reason on any other move", () => {
    expect(
      decideStatusChange({
        from: "closed",
        to: "in_progress",
        closeReason: "resolved",
      })
    ).toEqual({ ok: false, error: "close_reason_not_allowed" });
  });

  it("clears the close reason when a closed message is reopened", () => {
    expect(decideStatusChange({ from: "closed", to: "in_progress" })).toEqual({
      ok: true,
      changed: true,
      to: "in_progress",
      closeReason: null,
    });
  });

  it("checks the move before the reason", () => {
    expect(
      decideStatusChange({
        from: "in_progress",
        to: "new",
        closeReason: "spam",
      })
    ).toEqual({ ok: false, error: "transition_not_allowed" });
  });
});

describe("contact message assignment", () => {
  const ASHA = "0194c5a0-0000-7000-8000-000000000001";
  const RAVI = "0194c5a0-0000-7000-8000-000000000002";

  it("starts a new message when someone is assigned", () => {
    expect(
      decideAssignment({ status: "new", assigneeId: null, to: ASHA })
    ).toEqual({ ok: true, changed: true, status: "in_progress" });
  });

  it("keeps a message in progress when it is reassigned", () => {
    expect(
      decideAssignment({ status: "in_progress", assigneeId: ASHA, to: RAVI })
    ).toEqual({ ok: true, changed: true, status: "in_progress" });
  });

  it("unassigns without changing the status", () => {
    expect(
      decideAssignment({ status: "in_progress", assigneeId: ASHA, to: null })
    ).toEqual({ ok: true, changed: true, status: "in_progress" });
    expect(
      decideAssignment({ status: "new", assigneeId: null, to: null })
    ).toEqual({ ok: true, changed: false, status: "new" });
  });

  it("changes nothing when the assignee is already assigned", () => {
    expect(
      decideAssignment({ status: "in_progress", assigneeId: ASHA, to: ASHA })
    ).toEqual({ ok: true, changed: false, status: "in_progress" });
  });

  it("refuses to assign a closed message until it is reopened", () => {
    expect(
      decideAssignment({ status: "closed", assigneeId: ASHA, to: RAVI })
    ).toEqual({ ok: false, error: "message_closed" });
    expect(
      decideAssignment({ status: "closed", assigneeId: ASHA, to: null })
    ).toEqual({ ok: false, error: "message_closed" });
  });
});
