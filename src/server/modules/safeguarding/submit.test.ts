import { eq, getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import {
  formRateLimit,
  humanCheckRedemption,
  inboxItem,
  messageDelivery,
  outbox,
  safeguardingReport,
} from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";
import { solvedHumanCheck } from "@/test/human-check";

import {
  CONCERN,
  CONCERN_WORDS,
  dumpTable,
  safeguardingAuditRows,
} from "./testing";

/** What the public form sends for CONCERN. */
const FORM = { ...CONCERN };

/** Sends the form as `actor`, after passing the human check. */
async function send(
  h: Harness,
  actor: Actor,
  fields: Record<string, unknown> = {},
  options: { fillSeconds?: number } = {}
) {
  const humanCheck = await solvedHumanCheck(h, actor, options);
  return h
    .as(actor)
    .submitSafeguardingReport({ ...FORM, humanCheck, ...fields });
}

async function counts(h: Harness) {
  const [reports, limits, redemptions, events] = await Promise.all([
    h.db.$count(safeguardingReport),
    h.db.$count(formRateLimit),
    h.db.$count(humanCheckRedemption),
    h.db.$count(outbox),
  ]);
  return { reports, limits, redemptions, events };
}

const NOTHING = { reports: 0, limits: 0, redemptions: 0, events: 0 };

/** The start of an hour, so a test's submissions share one window. */
const ON_THE_HOUR = "2026-03-02T04:30:00Z";

describe("submitSafeguardingReport", () => {
  it("stores a new report and answers { ok: true } with nothing else", async () => {
    const h = await createHarness();

    const result = await send(h, h.visitor(), { anonymous: true });

    expect(result).toStrictEqual({ ok: true });
    const rows = await h.db.select().from(safeguardingReport);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "new",
      severity: null,
      assignedToUserId: null,
      category: CONCERN.category,
      subjectAge: CONCERN.subjectAge,
      anonymous: true,
      reporterName: null,
      reporterContact: null,
      createdAt: h.clock.now(),
      reference: expect.stringMatching(/^SG-\d{2}-[0-9A-HJKMNP-TV-Z]{6}$/),
    });
  });

  it("stores everything typed encrypted, so a raw dump shows none of it", async () => {
    const h = await createHarness();

    await send(h, h.visitor());

    const dump = [
      await dumpTable(h, "safeguarding_report"),
      await dumpTable(h, "audit_log"),
      await dumpTable(h, "outbox"),
    ].join("\n");
    for (const word of CONCERN_WORDS) expect(dump).not.toContain(word);
  });

  it("keeps no IP, user or user agent, even from a signed-in user", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const actor = await h.signIn(member, {
      ip: "203.0.113.77",
      userAgent: "Signed-in browser",
    });

    expect(await send(h, actor)).toStrictEqual({ ok: true });

    const columns = Object.values(getTableColumns(safeguardingReport)).map(
      (column) => column.name
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/ip|user_id|agent/)])
    );
    const audits = await safeguardingAuditRows(h);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "safeguarding.report_submitted",
      actorKind: "visitor",
      actorUserId: null,
      actorRole: null,
      ip: null,
      userAgent: null,
      entityType: "safeguarding_report",
      before: null,
      after: { status: "new", severity: null, assignedToUserId: null },
    });
    const everything = [
      await dumpTable(h, "safeguarding_report"),
      await dumpTable(h, "audit_log"),
      await dumpTable(h, "form_rate_limit"),
    ].join("\n");
    expect(everything).not.toContain("203.0.113.77");
    expect(everything).not.toContain("Signed-in browser");
    expect(everything).not.toContain(member.id);
  });

  it("drops a name and contact typed before ticking anonymous", async () => {
    const h = await createHarness();

    await send(h, h.visitor(), { anonymous: true });

    const dump = await dumpTable(h, "safeguarding_report");
    const [row] = await h.db.select().from(safeguardingReport);
    expect(row).toMatchObject({ reporterName: null, reporterContact: null });
    expect(dump).not.toContain("reporter_name\":\"v");
  });

  it("names the fields to fix, and spends no proof on a form sent back", async () => {
    const h = await createHarness();
    const humanCheck = await solvedHumanCheck(h, h.visitor());

    const result = await h.as(h.visitor()).submitSafeguardingReport({
      ...FORM,
      description: "  ",
      subjectAge: 30,
      humanCheck,
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["description", "subjectAge"],
    });
    expect(await counts(h)).toEqual(NOTHING);
    expect(
      await h.as(h.visitor()).submitSafeguardingReport({ ...FORM, humanCheck })
    ).toStrictEqual({ ok: true });
  });
});

describe("the form's abuse controls", () => {
  it("refuses a missing, wrong, expired or reused proof, storing nothing", async () => {
    const h = await createHarness();
    const visitor = h.visitor();
    const refused = { ok: false, error: "human_check_failed" };

    expect(
      await h.as(visitor).submitSafeguardingReport({ ...FORM })
    ).toStrictEqual(refused);
    const proof = await solvedHumanCheck(h, visitor);
    expect(
      await h.as(visitor).submitSafeguardingReport({
        ...FORM,
        humanCheck: { token: proof.token, nonce: proof.nonce + 1 },
      })
    ).toStrictEqual(refused);
    const stale = await solvedHumanCheck(h, visitor);
    h.clock.advance({ hours: 3 });
    expect(
      await h.as(visitor).submitSafeguardingReport({ ...FORM, humanCheck: stale })
    ).toStrictEqual(refused);
    expect(await counts(h)).toEqual(NOTHING);

    const once = await solvedHumanCheck(h, visitor);
    expect(
      await h.as(visitor).submitSafeguardingReport({ ...FORM, humanCheck: once })
    ).toStrictEqual({ ok: true });
    expect(
      await h.as(visitor).submitSafeguardingReport({ ...FORM, humanCheck: once })
    ).toStrictEqual(refused);
    expect((await counts(h)).reports).toBe(1);
  });

  it("answers a filled honeypot or a 2-second form as if it worked, and keeps nothing", async () => {
    const h = await createHarness();

    expect(
      await send(h, h.visitor(), { website: "https://spam.example" })
    ).toStrictEqual({ ok: true });
    expect(
      await send(h, h.visitor(), {}, { fillSeconds: 2 })
    ).toStrictEqual({ ok: true });
    await h.drain();

    expect(await counts(h)).toEqual(NOTHING);
    expect(h.email.sent).toEqual([]);
    expect(await safeguardingAuditRows(h)).toEqual([]);
  });

  it("refuses the 11th report from one IP in an hour, then takes reports again", async () => {
    const h = await createHarness({ now: ON_THE_HOUR });
    const visitor = h.visitor({ ip: "198.51.100.23" });
    for (let report = 1; report <= 10; report++) {
      expect(await send(h, visitor, {}, { fillSeconds: 4 })).toStrictEqual({
        ok: true,
      });
    }

    const refused = await send(h, visitor, {}, { fillSeconds: 4 });

    expect(refused).toEqual({
      ok: false,
      error: "rate_limited",
      retryAfter: new Date("2026-03-02T05:00:00Z"),
      retryAfterSeconds: expect.any(Number),
    });
    expect((await counts(h)).reports).toBe(10);
    expect(
      await send(h, h.visitor({ ip: "198.51.100.99" }))
    ).toStrictEqual({ ok: true });
    h.clock.set(new Date("2026-03-02T05:00:10Z"));
    expect(await send(h, visitor)).toStrictEqual({ ok: true });
    expect(await dumpTable(h, "form_rate_limit")).not.toContain(
      "198.51.100"
    );
  });
});

describe("the safeguarding leads' alert", () => {
  it("tells each lead a report came in, by email and in-app, with none of its content", async () => {
    const h = await createHarness();
    const leads = [await h.seed.member(), await h.seed.member()];
    for (const lead of leads) {
      await h.seed.grant(lead, {
        role: "safeguarding_lead",
        scope: { type: "global" },
      });
    }
    const admin = await h.seed.superAdmin();

    expect(await send(h, h.visitor())).toStrictEqual({ ok: true });
    await h.drain();

    const [report] = await h.db.select().from(safeguardingReport);
    const secrets = [...CONCERN_WORDS, CONCERN.category, report!.reference];
    for (const lead of leads) {
      const emails = h.email.sent.filter((email) => email.to === lead.email);
      expect(emails).toHaveLength(1);
      const items = await h.db
        .select()
        .from(inboxItem)
        .where(eq(inboxItem.userId, lead.id));
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        templateKey: "safeguarding.report_alert",
      });
      const text = JSON.stringify({ emails, items });
      expect(text).toContain("/admin/safeguarding");
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
    expect(h.email.sent.filter((email) => email.to === admin.email)).toEqual(
      []
    );
    const deliveries = await h.db.select().from(messageDelivery);
    expect(deliveries.length).toBeGreaterThan(0);
    for (const delivery of deliveries) {
      expect(leads.map((lead) => lead.id)).toContain(delivery.userId);
    }
  });
});
