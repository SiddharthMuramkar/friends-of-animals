// The signed-in user's own roles and the dashboards they open (#59). The
// dashboard switcher lists these; each dashboard is its own URL, so there
// is no "active role" to store.

import type { Dashboard } from "./domain/dashboards";
import { dashboardsFor } from "./domain/dashboards";
import type { Grant } from "./domain/roles";
import { authorize } from "./can";
import { grantsOf } from "./grants";
import type { AccessContext } from "./manage-roles";

export type MyAccess = { grants: Grant[]; dashboards: Dashboard[] };

export async function myAccess(ctx: AccessContext): Promise<MyAccess> {
  await authorize(ctx, "access.view-own");
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const grants = await grantsOf(ctx.db, ctx.actor.userId);
  return { grants, dashboards: dashboardsFor(grants) };
}
