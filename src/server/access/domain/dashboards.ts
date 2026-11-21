// Which dashboards a user's grants open (#59). One account, several roles:
// the dashboard switcher lists these areas, and the URL says which one is
// open, so there is no "active role" to store.
//
// Loads under plain Node: no "server-only", no `@/` imports.

import { isStaffRole, type Grant } from "./roles";

export type Dashboard =
  | { area: "member" }
  | { area: "admin" }
  | { area: "institution"; institutionId: string }
  | { area: "judge" }
  | { area: "organisation"; organisationId: string };

/**
 * Every signed-in user has the member dashboard; staff roles add the admin
 * one, school roles one per institution, judges the judging one and
 * organisation representatives one per organisation. Participants,
 * guardians and volunteers stay on the member dashboard. Order: member,
 * admin, institutions, judge, organisations; ids sorted.
 */
export function dashboardsFor(grants: readonly Grant[]): Dashboard[] {
  const institutions = new Set<string>();
  const organisations = new Set<string>();
  let admin = false;
  let judge = false;
  for (const { role, scope } of grants) {
    if (isStaffRole(role)) admin = true;
    if (role === "judge") judge = true;
    if (
      (role === "institution_admin" || role === "institution_coordinator") &&
      scope.type === "institution"
    ) {
      institutions.add(scope.id);
    }
    if (
      role === "organisation_representative" &&
      scope.type === "organisation"
    ) {
      organisations.add(scope.id);
    }
  }
  return [
    { area: "member" },
    ...(admin ? [{ area: "admin" } as const] : []),
    ...[...institutions]
      .sort()
      .map(
        (institutionId) => ({ area: "institution", institutionId }) as const
      ),
    ...(judge ? [{ area: "judge" } as const] : []),
    ...[...organisations]
      .sort()
      .map(
        (organisationId) => ({ area: "organisation", organisationId }) as const
      ),
  ];
}
