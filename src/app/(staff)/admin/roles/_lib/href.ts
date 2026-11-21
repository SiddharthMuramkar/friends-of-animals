// The roles page's URL: the search, the chosen user and what just happened
// all live in search params, so the page needs no client state and a
// refresh or a shared link shows the same thing.

export type RolesDone = "granted" | "revoked" | "unchanged";

export type RolesParams = {
  q?: string;
  user?: string;
  done?: RolesDone;
  /** New on each change, so the same outcome twice is announced twice. */
  at?: string;
};

export function rolesHref(_params: RolesParams): string {
  throw new Error("Not implemented");
}

export function readRolesParams(
  _searchParams: Record<string, string | string[] | undefined>
): RolesParams {
  throw new Error("Not implemented");
}
