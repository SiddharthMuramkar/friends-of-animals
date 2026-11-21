// Where each of a user's dashboards lives. The URL says which area is
// open, so the switcher is a list of links and no "active role" is
// stored. No area has its own route yet, so each is a section of
// /dashboard; #73 (institutions), #95 (judging) and the rest point
// theirs at real routes here.

import type { Dashboard } from "@/server/access";

export type DashboardLink = {
  area: Dashboard["area"];
  /** The institution's or organisation's id. */
  id?: string;
  /** The id of the area's section on /dashboard. */
  section: string;
  href: string;
};

export function dashboardLinks(_dashboards: Dashboard[]): DashboardLink[] {
  throw new Error("Not implemented");
}
