// What a grant or revoke came to, for the roles screen: a change to
// announce, or a refusal to explain with one of adminRoles.alerts.

import type { GrantRoleResult, RevokeRoleResult } from "@/server/access";

export const ROLE_ALERTS = [
  "invalid_input",
  "scope_not_allowed",
  "last_super_admin",
  "not_found",
  "forbidden",
] as const;

export type RoleAlert = (typeof ROLE_ALERTS)[number];

export type RoleField = "role" | "scopeType" | "scopeId";

/** What the action got when the policy refused (a DomainError). */
export const REFUSED = { ok: false, error: "forbidden" } as const;

export type RoleChangeResult =
  | GrantRoleResult
  | RevokeRoleResult
  | typeof REFUSED;

export type RoleChangeOutcome =
  | { ok: true; done: "granted" | "revoked" | "unchanged" }
  | { ok: false; alert: RoleAlert; fields: RoleField[] };

/** The use case's input fields, as the form names them. */
const FORM_FIELD: Record<string, RoleField> = {
  role: "role",
  scope: "scopeId",
};

export function roleChangeOutcome(
  change: "granted" | "revoked",
  result: RoleChangeResult
): RoleChangeOutcome {
  if (result.ok)
    return { ok: true, done: result.changed ? change : "unchanged" };
  switch (result.error) {
    case "invalid_input": {
      // The user id comes from the page's own link, so a bad one was
      // edited by hand: that user can't be found.
      if (result.fields.includes("userId")) {
        return { ok: false, alert: "not_found", fields: [] };
      }
      const fields = result.fields.flatMap((name) => FORM_FIELD[name] ?? []);
      return { ok: false, alert: "invalid_input", fields };
    }
    case "scope_not_allowed":
      return { ok: false, alert: result.error, fields: ["scopeType"] };
    case "last_super_admin":
    case "not_found":
    case "forbidden":
      return { ok: false, alert: result.error, fields: [] };
  }
}
