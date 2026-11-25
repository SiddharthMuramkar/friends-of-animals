// Where each of a user's dashboards lives. The URL says which area is
// open, so the switcher is a list of links and no "active role" is
// stored. No area has its own route yet, so each is a section of
// /dashboard; #73 (institutions), #95 (judging) and the rest point
// theirs at real routes here.

import { APP_ROUTES, JUDGE_DASHBOARD } from "@/lib/app-routes";
import type { Dashboard } from "@/server/access";

export type DashboardLink = {
  area: Dashboard["area"];
  /** The institution's or organisation's id. */
  id?: string;
  /** The id of the area's section on /dashboard. */
  section: string;
  href: string;
};

function linkTo(area: Dashboard["area"], id?: string): DashboardLink {
  const section = id === undefined ? area : `${area}-${id}`;
  return {
    area,
    ...(id === undefined ? {} : { id }),
    section,
    href: `${APP_ROUTES.dashboard}#${section}`,
  };
}

export function dashboardLinks(dashboards: Dashboard[]): DashboardLink[] {
  return dashboards.map((dashboard) => {
    switch (dashboard.area) {
      case "institution":
        return linkTo("institution", dashboard.institutionId);
      case "judge":
        return { ...linkTo("judge"), href: JUDGE_DASHBOARD };
      case "organisation":
        return linkTo("organisation", dashboard.organisationId);
      default:
        return linkTo(dashboard.area);
    }
  });
}
