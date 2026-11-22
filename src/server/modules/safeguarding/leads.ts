// Who the safeguarding leads are (#116): every user holding the role,
// which is only granted globally. The lead's report page offers them as
// assignees, and #69's dispatcher sends each of them the
// `safeguarding.report_alert` message through the `safeguarding_leads`
// audience (src/server/modules/notifications/audiences.ts). That alert's
// templates say only that a report came in and where to read it: never the
// report's category, reference or words, which stay behind the lead's
// sign-in and second factor.
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { user, userRole } from "../../db/schema";

/** Someone a lead sees by name: an assignee, a log entry's author. */
export type PersonRef = { id: string; name: string };

/** Every user holding the global safeguarding lead role, by name. */
export async function safeguardingLeads(db: AppDb): Promise<PersonRef[]> {
  return db
    .selectDistinct({ id: user.id, name: user.name })
    .from(userRole)
    .innerJoin(user, eq(user.id, userRole.userId))
    .where(
      and(
        eq(userRole.role, "safeguarding_lead"),
        eq(userRole.scopeType, "global")
      )
    )
    .orderBy(asc(user.name), asc(user.id));
}
