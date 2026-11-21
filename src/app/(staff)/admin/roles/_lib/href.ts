// The roles page's URL: the search, the chosen user and what just happened
// all live in search params, so the page needs no client state and a
// refresh or a shared link shows the same thing.

import { APP_ROUTES } from "@/lib/app-routes";

import { firstParam, type SearchParams } from "../../_lib/search-params";

export type RolesDone = "granted" | "revoked" | "unchanged";

export type RolesParams = {
  q?: string;
  user?: string;
  done?: RolesDone;
  /** New on each change, so the same outcome twice is announced twice. */
  at?: string;
};

const DONE: readonly RolesDone[] = ["granted", "revoked", "unchanged"];

export function rolesHref(params: RolesParams): string {
  const query = new URLSearchParams();
  for (const name of ["q", "user", "done", "at"] as const) {
    const value = params[name];
    if (value) query.set(name, value);
  }
  const search = query.toString();
  return search ? `${APP_ROUTES.adminRoles}?${search}` : APP_ROUTES.adminRoles;
}

export function readRolesParams(searchParams: SearchParams): RolesParams {
  const params: RolesParams = {};
  const q = firstParam(searchParams, "q");
  const user = firstParam(searchParams, "user");
  const done = firstParam(searchParams, "done");
  const at = firstParam(searchParams, "at");
  if (q) params.q = q;
  if (user) params.user = user;
  if (done && (DONE as readonly string[]).includes(done)) {
    params.done = done as RolesDone;
  }
  if (at) params.at = at;
  return params;
}
