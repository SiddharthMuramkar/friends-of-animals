// Roles and their scopes (#59). A user holds any number of grants; each
// grant is one role at one scope: global, or one institution, competition
// or organisation. The role and scope enums in the schema are built from
// these lists, so this file loads under plain Node (drizzle-kit, the seed
// script): no "server-only", no `@/` imports.

import { z } from "zod";

/** Every role on the platform, as #55 lists them. */
export const ROLES = [
  "member",
  "participant",
  "guardian",
  "institution_admin",
  "institution_coordinator",
  "judge",
  "volunteer",
  "organisation_representative",
  "staff_admin",
  "super_admin",
  "competition_manager",
  "content_manager",
  "community_manager",
  "finance",
  "auction_manager",
  "adoption_coordinator",
  // Appended by later tickets, each in its own migration (enum order).
  "grievance_officer",
] as const;

export type Role = (typeof ROLES)[number];

export const SCOPE_TYPES = [
  "global",
  "institution",
  "competition",
  "organisation",
] as const;

export type ScopeType = (typeof SCOPE_TYPES)[number];

/** One institution, competition or organisation, by id. */
export type ScopedScope = {
  type: Exclude<ScopeType, "global">;
  id: string;
};

export type Scope = { type: "global" } | ScopedScope;

export type Grant = { role: Role; scope: Scope };

/**
 * The scope types each role may be granted at. A grant outside these is
 * refused, so a super admin can't be "scoped" to one school by mistake.
 * Defaults until FOA rules otherwise; the round scope for judges arrives
 * with #95.
 */
export const ROLE_SCOPE_TYPES: Readonly<Record<Role, readonly ScopeType[]>> = {
  member: ["global"],
  participant: ["global", "competition"],
  guardian: ["global"],
  institution_admin: ["institution"],
  institution_coordinator: ["institution"],
  judge: ["global", "competition"],
  volunteer: ["global", "organisation"],
  organisation_representative: ["organisation"],
  staff_admin: ["global"],
  super_admin: ["global"],
  competition_manager: ["global", "competition"],
  content_manager: ["global"],
  community_manager: ["global"],
  finance: ["global"],
  auction_manager: ["global"],
  adoption_coordinator: ["global", "organisation"],
  grievance_officer: ["global"],
};

/** FOA's own people. Staff roles need a second factor (#60). */
const STAFF_ROLES: ReadonlySet<Role> = new Set<Role>([
  "staff_admin",
  "super_admin",
  "competition_manager",
  "content_manager",
  "community_manager",
  "finance",
  "auction_manager",
  "adoption_coordinator",
  "grievance_officer",
]);

export function isStaffRole(role: Role): boolean {
  return STAFF_ROLES.has(role);
}

/** Parses a scope from untrusted input; scoped ones need a UUID. */
export const scopeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("global") }),
  z.strictObject({
    type: z.enum(["institution", "competition", "organisation"]),
    id: z.uuid(),
  }),
]);

/**
 * Parses a grant from untrusted input. A role at a scope type it can't
 * hold fails with the message "scope_not_allowed".
 */
export const grantSchema = z
  .strictObject({ role: z.enum(ROLES), scope: scopeSchema })
  .refine((grant) => ROLE_SCOPE_TYPES[grant.role].includes(grant.scope.type), {
    message: "scope_not_allowed",
    path: ["scope", "type"],
  });

/** A grant as one string: `judge@competition:<id>`, `member@global`. */
export function grantKey(grant: Grant): string {
  const scope =
    grant.scope.type === "global"
      ? "global"
      : `${grant.scope.type}:${grant.scope.id}`;
  return `${grant.role}@${scope}`;
}

/** Grants without duplicates, ordered by key, so two sets compare. */
export function sortGrants(grants: readonly Grant[]): Grant[] {
  const byKey = new Map(grants.map((grant) => [grantKey(grant), grant]));
  return [...byKey.keys()].sort().map((key) => byKey.get(key)!);
}
