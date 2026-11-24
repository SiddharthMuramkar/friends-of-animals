// The safeguarding module owns the retention date for each report (#116).
// The sweep checks the relevant user holds before deleting the report and
// its incident log (ON DELETE CASCADE).

import { and, inArray, isNotNull } from "drizzle-orm";

import {
  safeguardingIncidentLog,
  safeguardingReport,
} from "../../../db/schema";
import { SAFEGUARDING_RETENTION_POLICY } from "../../safeguarding/retention-policy";
import type { RetentionPolicy } from "./types";

export const SAFEGUARDING_REPORTS: RetentionPolicy = {
  key: SAFEGUARDING_RETENTION_POLICY.key,
  table: "safeguarding_report",
  action: SAFEGUARDING_RETENTION_POLICY.action,
  period: { kind: "fixed" },
  async candidates(db, query) {
    // The leads' actions also lock the report before writing incident entries.
    const { reports, next: nextId } =
      await SAFEGUARDING_RETENTION_POLICY.candidates(db, {
        ...query,
        after: query.after?.id ?? null,
      });
    const next = nextId === null ? null : { id: nextId };
    if (reports.length === 0) return { candidates: [], next };
    const authors = await db
      .selectDistinct({
        reportId: safeguardingIncidentLog.reportId,
        userId: safeguardingIncidentLog.authorUserId,
      })
      .from(safeguardingIncidentLog)
      .where(
        and(
          inArray(
            safeguardingIncidentLog.reportId,
            reports.map(({ id }) => id)
          ),
          isNotNull(safeguardingIncidentLog.authorUserId)
        )
      );
    const usersByReport = new Map<string, Set<string>>();
    for (const { reportId, userId } of authors) {
      if (userId === null) continue;
      const users = usersByReport.get(reportId) ?? new Set<string>();
      users.add(userId);
      usersByReport.set(reportId, users);
    }
    const candidates = reports.map(({ id, assignee, anchor }) => {
      const users = usersByReport.get(id) ?? new Set<string>();
      if (assignee !== null) users.add(assignee);
      return {
        id,
        anchor,
        subjects: [...users].map((id) => ({ type: "user", id })),
      };
    });
    return { candidates, next };
  },
  async apply(db, ids) {
    if (ids.length > 0) {
      await db
        .delete(safeguardingReport)
        .where(inArray(safeguardingReport.id, [...ids]));
    }
  },
};
