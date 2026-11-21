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

export function roleChangeOutcome(
  _change: "granted" | "revoked",
  _result: RoleChangeResult
): RoleChangeOutcome {
  throw new Error("Not implemented");
}
