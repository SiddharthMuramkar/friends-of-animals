import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import {
  safeguardingIncidentLog,
  safeguardingReport,
} from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import {
  CONCERN,
  CONCERN_WORDS,
  dumpTable,
  fileReport,
  safeguardingAuditRows,
  signInLead,
} from "./testing";

const OUTCOME = "Zeppelin outcome handed over";
const AUTHORITY = "Narwhal SJPU reference 77";
const NOTE = "Xylophone note about a call";

async function logOf(h: Harness, reportId: string) {
  return h.db
    .select()
    .from(safeguardingIncidentLog)
    .where(eq(safeguardingIncidentLog.reportId, reportId))
    .orderBy(safeguardingIncidentLog.id);
}

async function reportRow(h: Harness, reportId: string) {
  const [row] = await h.db
    .select()
    .from(safeguardingReport)
    .where(eq(safeguardingReport.id, reportId));
  return row;
}

const OUTSIDERS = [
  "super_admin",
  "staff_admin",
  "content_manager",
  "competition_manager",
  "community_manager",
  "finance",
  "adoption_coordinator",
  "auction_manager",
  "guardian",
  "a plain member",
  "a visitor",
] as const;

async function outsider(
  h: Harness,
  who: (typeof OUTSIDERS)[number]
): Promise<Actor> {
  if (who === "a visitor") return h.visitor();
  const user = await h.seed.member();
  if (who !== "a plain member") {
    await h.seed.grant(user, { role: who, scope: { type: "global" } });
  }
  return h.signIn(user);
}

describe("only a safeguarding lead reads and handles reports", () => {
  it.each(OUTSIDERS)(
    "refuses %s every use case, writing nothing",
    async (who) => {
      const h = await createHarness();
      const reportId = await fileReport(h);
      const lead = await h.seed.member();
      await h.seed.grant(lead, {
        role: "safeguarding_lead",
        scope: { type: "global" },
      });
      const app = h.as(await outsider(h, who));
      const before = await reportRow(h, reportId);

      const attempts = [
        () => app.listSafeguardingReports(),
        () => app.viewSafeguardingReport({ reportId }),
        () =>
          app.moveSafeguardingReport({
            reportId,
            action: { event: "triage", severity: "high" },
          }),
        () =>
          app.assignSafeguardingReport({ reportId, assigneeUserId: lead.id }),
        () => app.addIncidentLogEntry({ reportId, body: NOTE }),
      ];
      for (const attempt of attempts) {
        await expect(attempt()).rejects.toMatchObject({ code: "forbidden" });
      }

      expect(await safeguardingAuditRows(h)).toEqual([]);
      expect(await logOf(h, reportId)).toEqual([]);
      expect(await reportRow(h, reportId)).toEqual(before);
    }
  );

  it("refuses a lead who hasn't passed their second factor, writing nothing", async () => {
    const h = await createHarness();
    const reportId = await fileReport(h);
    const lead = await h.seed.member();
    await h.seed.grant(lead, {
      role: "safeguarding_lead",
      scope: { type: "global" },
    });
    const before = await reportRow(h, reportId);

    // Never set one up, then set up but not passed in this session.
    const unenrolled = h.as(
      await h.signIn(lead, undefined, { secondFactor: false })
    );
    await expect(unenrolled.listSafeguardingReports()).rejects.toMatchObject({
      code: "enrolment_required",
    });
    await expect(
      unenrolled.viewSafeguardingReport({ reportId })
    ).rejects.toMatchObject({ code: "enrolment_required" });
    await h.seed.authenticator({ id: lead.id });
    const unpassed = h.as(
      await h.signIn(lead, undefined, { secondFactor: false })
    );
    await expect(
      unpassed.viewSafeguardingReport({ reportId })
    ).rejects.toMatchObject({ code: "second_factor_required" });
    await expect(
      unpassed.addIncidentLogEntry({ reportId, body: NOTE })
    ).rejects.toMatchObject({ code: "second_factor_required" });

    expect(await safeguardingAuditRows(h)).toEqual([]);
    expect(await logOf(h, reportId)).toEqual([]);
    expect(await reportRow(h, reportId)).toEqual(before);
  });
});

describe("the lead's queue", () => {
  it("lists open reports, new first, without their text, and audits how many it showed", async () => {
    const h = await createHarness();
    const { actor } = await signInLead(h);
    const older = await fileReport(h);
    h.clock.advance({ minutes: 5 });
    const triaged = await fileReport(h);
    h.clock.advance({ minutes: 5 });
    const newest = await fileReport(h);
    const app = h.as(actor);
    await app.moveSafeguardingReport({
      reportId: triaged,
      action: { event: "triage", severity: "critical" },
    });

    const result = await app.listSafeguardingReports();

    expect(result).toMatchObject({ ok: true, view: "open", more: false });
    if (!result.ok) throw new Error("expected the queue");
    expect(result.reports.map((report) => report.id)).toEqual([
      older,
      newest,
      triaged,
    ]);
    expect(result.reports[2]).toMatchObject({
      status: "triaged",
      severity: "critical",
      category: CONCERN.category,
      reference: expect.stringMatching(/^SG-\d{2}-[0-9A-HJKMNP-TV-Z]{6}$/),
    });
    const json = JSON.stringify(result);
    for (const word of CONCERN_WORDS) expect(json).not.toContain(word);

    const audits = await safeguardingAuditRows(h);
    expect(audits.at(-1)).toMatchObject({
      action: "safeguarding.queue_viewed",
      actorKind: "user",
      actorRole: "safeguarding_lead",
      entityType: "safeguarding_queue",
      entityId: "open",
      before: null,
      after: { shown: 3 },
    });
  });

  it("lists resolved reports apart from open ones", async () => {
    const h = await createHarness();
    const { actor } = await signInLead(h);
    const app = h.as(actor);
    const open = await fileReport(h);
    const done = await fileReport(h);
    await app.moveSafeguardingReport({
      reportId: done,
      action: { event: "triage", severity: "low" },
    });
    await app.moveSafeguardingReport({
      reportId: done,
      action: { event: "resolve", outcome: OUTCOME },
    });

    const openQueue = await app.listSafeguardingReports({ view: "open" });
    const resolved = await app.listSafeguardingReports({ view: "resolved" });

    expect(openQueue.ok && openQueue.reports.map((r) => r.id)).toEqual([open]);
    expect(resolved.ok && resolved.reports.map((r) => r.id)).toEqual([done]);
  });
});

describe("a lead reading a report", () => {
  it("decrypts it, lists what may happen next, and audits the view by status only", async () => {
    const h = await createHarness();
    const { actor } = await signInLead(h, { name: "Lead One" });
    const reportId = await fileReport(h);

    const result = await h.as(actor).viewSafeguardingReport({ reportId });

    expect(result).toMatchObject({
      ok: true,
      report: {
        id: reportId,
        ...CONCERN,
        status: "new",
        severity: null,
        assignedTo: null,
        outcome: null,
        escalationReference: null,
        allowedEvents: ["triage"],
        log: [],
        leads: [{ name: "Lead One" }],
      },
    });
    const audits = await safeguardingAuditRows(h);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "safeguarding.report_viewed",
      entityType: "safeguarding_report",
      entityId: reportId,
      before: { status: "new", severity: null, assignedToUserId: null },
      after: { status: "new", severity: null, assignedToUserId: null },
    });
  });

  it("says not_found for an unknown report and audits nothing", async () => {
    const h = await createHarness();
    const { actor } = await signInLead(h);

    const result = await h.as(actor).viewSafeguardingReport({
      reportId: "01938a00-0000-7000-8000-0000000fffff",
    });

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(await safeguardingAuditRows(h)).toEqual([]);
  });
});

describe("moving a report through the table", () => {
  it("triages, investigates, escalates and resolves, logging and auditing each step", async () => {
    const h = await createHarness();
    const { actor, id: leadId } = await signInLead(h);
    const app = h.as(actor);
    const reportId = await fileReport(h);

    expect(
      await app.moveSafeguardingReport({
        reportId,
        action: { event: "triage", severity: "high" },
      })
    ).toEqual({ ok: true, status: "triaged" });
    expect(
      await app.moveSafeguardingReport({
        reportId,
        action: { event: "start_investigation" },
      })
    ).toEqual({ ok: true, status: "investigating" });
    expect(
      await app.moveSafeguardingReport({
        reportId,
        action: { event: "escalate", authorityReference: AUTHORITY },
      })
    ).toEqual({ ok: true, status: "escalated" });
    expect(
      await app.moveSafeguardingReport({
        reportId,
        action: { event: "resolve", outcome: OUTCOME },
      })
    ).toEqual({ ok: true, status: "resolved" });

    const log = await logOf(h, reportId);
    expect(
      log.map(({ kind, toStatus, severity, authorUserId }) => ({
        kind,
        toStatus,
        severity,
        authorUserId,
      }))
    ).toEqual([
      {
        kind: "status_change",
        toStatus: "triaged",
        severity: "high",
        authorUserId: leadId,
      },
      {
        kind: "status_change",
        toStatus: "investigating",
        severity: null,
        authorUserId: leadId,
      },
      {
        kind: "escalation",
        toStatus: "escalated",
        severity: null,
        authorUserId: leadId,
      },
      {
        kind: "status_change",
        toStatus: "resolved",
        severity: null,
        authorUserId: leadId,
      },
    ]);

    const audits = await safeguardingAuditRows(h);
    expect(
      audits.map(({ action, before, after }) => ({ action, before, after }))
    ).toEqual([
      {
        action: "safeguarding.report_triaged",
        before: { status: "new", severity: null, assignedToUserId: null },
        after: { status: "triaged", severity: "high", assignedToUserId: null },
      },
      {
        action: "safeguarding.investigation_started",
        before: { status: "triaged", severity: "high", assignedToUserId: null },
        after: {
          status: "investigating",
          severity: "high",
          assignedToUserId: null,
        },
      },
      {
        action: "safeguarding.report_escalated",
        before: {
          status: "investigating",
          severity: "high",
          assignedToUserId: null,
        },
        after: {
          status: "escalated",
          severity: "high",
          assignedToUserId: null,
        },
      },
      {
        action: "safeguarding.report_resolved",
        before: {
          status: "escalated",
          severity: "high",
          assignedToUserId: null,
        },
        after: { status: "resolved", severity: "high", assignedToUserId: null },
      },
    ]);

    const view = await app.viewSafeguardingReport({ reportId });
    expect(view).toMatchObject({
      ok: true,
      report: {
        status: "resolved",
        outcome: OUTCOME,
        escalationReference: AUTHORITY,
        resolvedAt: h.clock.now(),
        allowedEvents: [],
        log: [
          { kind: "status_change", body: null },
          { kind: "status_change", body: null },
          { kind: "escalation", body: AUTHORITY },
          { kind: "status_change", body: OUTCOME },
        ],
      },
    });
  });

  it("refuses a move the table doesn't allow, writing nothing", async () => {
    const h = await createHarness();
    const { actor } = await signInLead(h);
    const app = h.as(actor);
    const reportId = await fileReport(h);

    expect(
      await app.moveSafeguardingReport({
        reportId,
        action: { event: "resolve", outcome: OUTCOME },
      })
    ).toEqual({ ok: false, error: "transition_not_allowed" });
    expect(
      await app.moveSafeguardingReport({
        reportId,
        action: { event: "start_investigation" },
      })
    ).toEqual({ ok: false, error: "transition_not_allowed" });
    expect(await reportRow(h, reportId)).toMatchObject({
      status: "new",
      outcome: null,
    });
    expect(await logOf(h, reportId)).toEqual([]);
    expect(await safeguardingAuditRows(h)).toEqual([]);
  });

  it("never moves a resolved report again", async () => {
    const h = await createHarness();
    const { actor } = await signInLead(h);
    const app = h.as(actor);
    const reportId = await fileReport(h);
    await app.moveSafeguardingReport({
      reportId,
      action: { event: "triage", severity: "medium" },
    });
    await app.moveSafeguardingReport({
      reportId,
      action: { event: "resolve", outcome: OUTCOME },
    });
    const audits = (await safeguardingAuditRows(h)).length;
    const entries = (await logOf(h, reportId)).length;

    for (const action of [
      { event: "triage", severity: "low" },
      { event: "start_investigation" },
      { event: "escalate", authorityReference: AUTHORITY },
      { event: "resolve", outcome: "Again" },
    ] as const) {
      expect(await app.moveSafeguardingReport({ reportId, action })).toEqual({
        ok: false,
        error: "report_resolved",
      });
    }
    expect(await safeguardingAuditRows(h)).toHaveLength(audits);
    expect(await logOf(h, reportId)).toHaveLength(entries);
  });

  it("refuses an escalation without the authority's reference", async () => {
    const h = await createHarness();
    const { actor } = await signInLead(h);
    const reportId = await fileReport(h);

    const result = await h.as(actor).moveSafeguardingReport({
      reportId,
      action: { event: "escalate", authorityReference: "  " },
    });

    expect(result).toMatchObject({ ok: false, error: "invalid_input" });
    expect(await safeguardingAuditRows(h)).toEqual([]);
  });
});

describe("assigning a report", () => {
  it("gives it to another lead, audited by assignee only", async () => {
    const h = await createHarness();
    const { actor } = await signInLead(h);
    const { id: deputy } = await signInLead(h);
    const reportId = await fileReport(h);

    const result = await h
      .as(actor)
      .assignSafeguardingReport({ reportId, assigneeUserId: deputy });

    expect(result).toEqual({ ok: true, changed: true });
    expect(await reportRow(h, reportId)).toMatchObject({
      assignedToUserId: deputy,
    });
    expect(await safeguardingAuditRows(h)).toMatchObject([
      {
        action: "safeguarding.report_assigned",
        before: { status: "new", severity: null, assignedToUserId: null },
        after: { status: "new", severity: null, assignedToUserId: deputy },
      },
    ]);
    const admin = await h.signIn(await h.seed.superAdmin());
    const { entries } = await h.as(admin).getInventory();
    expect(
      entries.find(
        ({ table, column }) =>
          table === "safeguarding_report" && column === "assigned_to_user_id"
      )
    ).toMatchObject({
      subject: { kind: "user", via: "assigned_to_user_id" },
      retention: { policy: "safeguardingReports" },
    });
  });

  it("refuses someone without the lead role, and records nothing for no change", async () => {
    const h = await createHarness();
    const { actor, id: leadId } = await signInLead(h);
    const admin = await h.seed.superAdmin();
    const reportId = await fileReport(h);
    const app = h.as(actor);

    expect(
      await app.assignSafeguardingReport({ reportId, assigneeUserId: admin.id })
    ).toEqual({ ok: false, error: "assignee_not_lead" });
    await app.assignSafeguardingReport({ reportId, assigneeUserId: leadId });
    expect(
      await app.assignSafeguardingReport({ reportId, assigneeUserId: leadId })
    ).toEqual({ ok: true, changed: false });
    expect(
      await app.assignSafeguardingReport({ reportId, assigneeUserId: null })
    ).toEqual({ ok: true, changed: true });

    expect((await safeguardingAuditRows(h)).map(({ after }) => after)).toEqual([
      { status: "new", severity: null, assignedToUserId: leadId },
      { status: "new", severity: null, assignedToUserId: null },
    ]);
  });
});

describe("the incident log", () => {
  it("takes a lead's note, even on a resolved report, audited by id and kind", async () => {
    const h = await createHarness();
    const { actor, id: leadId } = await signInLead(h);
    const app = h.as(actor);
    const reportId = await fileReport(h);
    await app.moveSafeguardingReport({
      reportId,
      action: { event: "triage", severity: "low" },
    });
    await app.moveSafeguardingReport({
      reportId,
      action: { event: "resolve", outcome: OUTCOME },
    });

    const result = await app.addIncidentLogEntry({ reportId, body: NOTE });

    expect(result).toEqual({ ok: true, entryId: expect.any(String) });
    if (!result.ok) throw new Error("expected a note");
    const log = await logOf(h, reportId);
    expect(log.at(-1)).toMatchObject({
      id: result.entryId,
      kind: "note",
      toStatus: null,
      authorUserId: leadId,
    });
    expect((await safeguardingAuditRows(h)).at(-1)).toMatchObject({
      action: "safeguarding.incident_log_entry_added",
      entityId: reportId,
      before: null,
      after: { entryId: result.entryId, kind: "note" },
    });
    const view = await app.viewSafeguardingReport({ reportId });
    expect(view.ok && view.report.log.at(-1)).toMatchObject({
      kind: "note",
      body: NOTE,
      author: { id: leadId },
    });
    const admin = await h.signIn(await h.seed.superAdmin());
    const { entries } = await h.as(admin).getInventory();
    expect(
      entries.find(
        ({ table, column }) =>
          table === "safeguarding_incident_log" && column === "author_user_id"
      )
    ).toMatchObject({
      subject: { kind: "user", via: "author_user_id" },
      retention: { policy: "safeguardingReports" },
    });
    expect(JSON.stringify(entries)).not.toContain(NOTE);
  });

  it("refuses an empty note", async () => {
    const h = await createHarness();
    const { actor } = await signInLead(h);
    const reportId = await fileReport(h);

    expect(
      await h.as(actor).addIncidentLogEntry({ reportId, body: "   " })
    ).toMatchObject({ ok: false, error: "invalid_input", fields: ["body"] });
    expect(await logOf(h, reportId)).toEqual([]);
  });

  it("refuses UPDATE and DELETE, but goes with its report when retention deletes it", async () => {
    const h = await createHarness();
    const { actor } = await signInLead(h);
    const reportId = await fileReport(h);
    await h.as(actor).addIncidentLogEntry({ reportId, body: NOTE });

    await expect(
      h.db.execute(
        sql`UPDATE safeguarding_incident_log SET author_user_id = NULL`
      )
    ).rejects.toThrow();
    await expect(
      h.db.execute(sql`DELETE FROM safeguarding_incident_log`)
    ).rejects.toThrow();
    await expect(
      h.db.execute(sql`TRUNCATE safeguarding_incident_log`)
    ).rejects.toThrow();
    expect(await logOf(h, reportId)).toHaveLength(1);

    await h.db
      .delete(safeguardingReport)
      .where(eq(safeguardingReport.id, reportId));
    expect(await logOf(h, reportId)).toEqual([]);
  });

  it("stores the lead's outcome, authority reference and notes encrypted", async () => {
    const h = await createHarness();
    const { actor } = await signInLead(h);
    const app = h.as(actor);
    const reportId = await fileReport(h);
    await app.moveSafeguardingReport({
      reportId,
      action: { event: "triage", severity: "high" },
    });
    await app.moveSafeguardingReport({
      reportId,
      action: { event: "start_investigation" },
    });
    await app.moveSafeguardingReport({
      reportId,
      action: { event: "escalate", authorityReference: AUTHORITY },
    });
    await app.addIncidentLogEntry({ reportId, body: NOTE });
    await app.moveSafeguardingReport({
      reportId,
      action: { event: "resolve", outcome: OUTCOME },
    });

    const dump = [
      await dumpTable(h, "safeguarding_report"),
      await dumpTable(h, "safeguarding_incident_log"),
      await dumpTable(h, "audit_log"),
    ].join("\n");
    for (const word of [...CONCERN_WORDS, "Zeppelin", "Narwhal", "Xylophone"]) {
      expect(dump).not.toContain(word);
    }
  });
});
