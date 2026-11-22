// The roles page's URL: the chosen user (by id) and what just happened live
// in search params, so a refresh or a shared link shows the same thing.
// Search text never does: it is a name or an email address, and a URL ends
// up in browser history and request logs. The search posts to a Server
// Action instead.

import { APP_ROUTES } from "@/lib/app-routes";

import { firstParam, type SearchParams } from "../../_lib/search-params";

export type RolesDone = "granted" | "revoked" | "unchanged";

export type RolesParams = {
  user?: string;
  done?: RolesDone;
  /** New on each change, so the same outcome twice is announced twice. */
  at?: string;
};

const DONE: readonly RolesDone[] = ["granted", "revoked", "unchanged"];

export function rolesHref(params: RolesParams): string {
  const query = new URLSearchParams();
  for (const name of ["user", "done", "at"] as const) {
    const value = params[name];
    if (value) query.set(name, value);
  }
  const search = query.toString();
  return search ? `${APP_ROUTES.adminRoles}?${search}` : APP_ROUTES.adminRoles;
}

export function readRolesParams(searchParams: SearchParams): RolesParams {
  const params: RolesParams = {};
  const user = firstParam(searchParams, "user");
  const done = firstParam(searchParams, "done");
  const at = firstParam(searchParams, "at");
  if (user) params.user = user;
  if (done && (DONE as readonly string[]).includes(done)) {
    params.done = done as RolesDone;
  }
  if (at) params.at = at;
  return params;
}
