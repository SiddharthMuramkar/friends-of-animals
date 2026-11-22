import { describe, expect, it } from "vitest";

import { messages } from "@/i18n/messages";

import { REFUSED, ROLE_ALERTS, roleChangeOutcome } from "./action-result";

const grant = {
  role: "institution_coordinator",
  scope: { type: "institution", id: "01938a00-0000-7000-8000-000000001001" },
} as const;

describe("roleChangeOutcome", () => {
  it("says a role was given or taken away when it changed", () => {
    expect(
      roleChangeOutcome("granted", { ok: true, changed: true, grant })
    ).toEqual({ ok: true, done: "granted" });
    expect(
      roleChangeOutcome("revoked", { ok: true, changed: true, grant })
    ).toEqual({ ok: true, done: "revoked" });
  });

  it("says nothing changed when they already held it, or never did", () => {
    expect(
      roleChangeOutcome("granted", { ok: true, changed: false, grant })
    ).toEqual({ ok: true, done: "unchanged" });
    expect(
      roleChangeOutcome("revoked", { ok: true, changed: false, grant })
    ).toEqual({ ok: true, done: "unchanged" });
  });

  it.each([
    ["scope_not_allowed", ["scopeType"]],
    ["last_super_admin", []],
    ["not_found", []],
  ] as const)("names the refusal %s", (error, fields) => {
    expect(roleChangeOutcome("revoked", { ok: false, error })).toEqual({
      ok: false,
      alert: error,
      fields,
    });
  });

  it("names a refusal by the policy as forbidden", () => {
    expect(roleChangeOutcome("granted", REFUSED)).toEqual({
      ok: false,
      alert: "forbidden",
      fields: [],
    });
  });

  it("points at the form's fields when the input was wrong", () => {
    expect(
      roleChangeOutcome("granted", {
        ok: false,
        error: "invalid_input",
        fields: ["role", "scope"],
      })
    ).toEqual({
      ok: false,
      alert: "invalid_input",
      fields: ["role", "scopeId"],
    });
  });

  it("calls a user id that isn't one a missing user", () => {
    // The id comes from the page's own link, so a bad one was edited.
    expect(
      roleChangeOutcome("revoked", {
        ok: false,
        error: "invalid_input",
        fields: ["userId"],
      })
    ).toEqual({ ok: false, alert: "not_found", fields: [] });
  });
});

describe("adminRoles messages", () => {
  it("has a message for every alert, so no raw code is ever shown", () => {
    for (const alert of ROLE_ALERTS) {
      expect(messages.adminRoles.alerts[alert], alert).toMatch(/\w/);
    }
  });

  it("has a message for every outcome that changed or kept a role", () => {
    for (const done of ["granted", "revoked", "unchanged"] as const) {
      expect(messages.adminRoles.done[done], done).toMatch(/\w/);
    }
  });
});
