import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  safeguardingIncidentLog,
  safeguardingReport,
  user,
  userRole,
} from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { seedFunctions } from "./builders";
import {
  SEED_SAFEGUARDING_LEAD,
  SEED_SAFEGUARDING_REPORTS,
  seedSafeguarding,
} from "./safeguarding";

describe("the safeguarding preview seed", () => {
  it("makes one lead and three reports, and changes nothing the second time", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const reports = () =>
      h.db
        .select({
          id: safeguardingReport.id,
          status: safeguardingReport.status,
          assignedToUserId: safeguardingReport.assignedToUserId,
        })
        .from(safeguardingReport)
        .orderBy(asc(safeguardingReport.id));
    const log = () =>
      h.db
        .select({
          id: safeguardingIncidentLog.id,
          reportId: safeguardingIncidentLog.reportId,
          kind: safeguardingIncidentLog.kind,
        })
        .from(safeguardingIncidentLog)
        .orderBy(asc(safeguardingIncidentLog.id));
    const first = { reports: await reports(), log: await log() };

    const leads = () =>
      h.db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, SEED_SAFEGUARDING_LEAD.email));
    const [lead] = await leads();
    expect(lead).toBeDefined();
    const grants = () =>
      h.db
        .select({ role: userRole.role, scopeType: userRole.scopeType })
        .from(userRole)
        .where(eq(userRole.userId, lead!.id));
    const firstGrants = await grants();
    expect(firstGrants).toEqual([
      { role: "safeguarding_lead", scopeType: "global" },
    ]);
    expect(first.reports).toEqual([
      {
        id: SEED_SAFEGUARDING_REPORTS.fresh,
        status: "new",
        assignedToUserId: null,
      },
      {
        id: SEED_SAFEGUARDING_REPORTS.investigating,
        status: "investigating",
        assignedToUserId: lead!.id,
      },
      {
        id: SEED_SAFEGUARDING_REPORTS.resolved,
        status: "resolved",
        assignedToUserId: lead!.id,
      },
    ]);
    expect(
      first.log
        .filter(
          (entry) => entry.reportId === SEED_SAFEGUARDING_REPORTS.investigating
        )
        .map((entry) => entry.kind)
    ).toEqual(["status_change", "status_change", "note"]);

    // The first full preview verifies the wiring. Rerun only the seeder
    // responsible for these accounts, grants, reports and incident logs.
    h.clock.advance({ days: 1 });
    await seedFunctions([seedSafeguarding]).seedPreview(h.deps);

    expect(await leads()).toEqual([lead]);
    expect(await grants()).toEqual(firstGrants);
    expect(await reports()).toEqual(first.reports);
    expect(await log()).toEqual(first.log);
  });

  it("lets the seeded lead read the seeded reports", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const lead = await h.signIn(SEED_SAFEGUARDING_LEAD);

    const queue = await h.as(lead).listSafeguardingReports();
    const report = await h.as(lead).viewSafeguardingReport({
      reportId: SEED_SAFEGUARDING_REPORTS.investigating,
    });

    expect(queue.ok && queue.reports.map((item) => item.id)).toEqual([
      SEED_SAFEGUARDING_REPORTS.fresh,
      SEED_SAFEGUARDING_REPORTS.investigating,
    ]);
    expect(report).toMatchObject({
      ok: true,
      report: {
        status: "investigating",
        severity: "high",
        reporterName: "Sample Reporter",
        log: [
          { kind: "status_change", toStatus: "triaged", body: null },
          { kind: "status_change", toStatus: "investigating", body: null },
          { kind: "note", body: expect.stringMatching(/^Sample note/) },
        ],
      },
    });
  });
});
