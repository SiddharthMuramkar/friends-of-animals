// Who hears that a safeguarding report came in (#116): every user holding
// the safeguarding lead role. #69's dispatcher sends them the
// `safeguarding.report_alert` message through the `safeguarding_leads`
// audience (src/server/modules/notifications/audiences.ts), and its
// templates say only that a report came in and where to read it: never
// the report's category, reference or words, which stay behind the lead's
// sign-in and second factor.
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { userRole } from "../../db/schema";

/** The ids of every safeguarding lead. The role is only granted globally. */
export async function safeguardingLeads(db: AppDb): Promise<string[]> {
  const rows = await db
    .select({ userId: userRole.userId })
    .from(userRole)
    .where(
      and(
        eq(userRole.role, "safeguarding_lead"),
        eq(userRole.scopeType, "global")
      )
    )
    .orderBy(asc(userRole.userId));
  return rows.map((row) => row.userId);
}
