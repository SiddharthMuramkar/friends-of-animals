import { count, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, consentEvent, outbox } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

const MESSAGES_SOURCE = [
  "- We email you news about competitions.",
  "",
  "## What you agree to {#what-you-agree-to}",
  "",
  "News and updates by email.",
].join("\n");

let publishers = 0;

/** Publishes the next messages version as a new super admin. */
async function publishMessages(h: Harness, title = "News and updates") {
  publishers += 1;
  const admin = await h.seed.superAdmin({
    email: `publisher-${publishers}@example.test`,
  });
  const actor = await h.signIn(admin);
  const published = await h.as(actor).publishConsentDocument({
    purpose: "messages",
    title,
    source: MESSAGES_SOURCE,
  });
  if (!published.ok) throw new Error("Could not publish");
  return published;
}

describe("giveConsent and withdrawConsent", () => {
  it("records a give and a withdrawal, which myConsents lists newest first", async () => {
    const h = await createHarness();
    const document = await publishMessages(h);
    const member = await h.signIn(await h.seed.member());
    const givenAt = h.clock.now();

    expect(
      await h
        .as(member)
        .giveConsent({ purpose: "messages", documentId: document.id })
    ).toEqual({ ok: true, changed: true });
    h.clock.advance({ minutes: 5 });
    expect(await h.as(member).withdrawConsent({ purpose: "messages" })).toEqual(
      { ok: true, changed: true }
    );

    const [messages, ...others] = await h.as(member).myConsents();
    expect(others).toEqual([]);
    expect(messages).toEqual({
      purpose: "messages",
      state: {
        status: "withdrawn",
        documentId: document.id,
        documentVersion: 1,
        since: h.clock.now(),
      },
      history: [
        {
          id: expect.any(String),
          action: "withdrawn",
          documentId: document.id,
          documentVersion: 1,
          method: "web_form",
          occurredAt: h.clock.now(),
        },
        {
          id: expect.any(String),
          action: "given",
          documentId: document.id,
          documentVersion: 1,
          method: "web_form",
          occurredAt: givenAt,
        },
      ],
      currentDocument: expect.objectContaining({
        id: document.id,
        version: 1,
        title: "News and updates",
      }),
    });
  });
});

describe("the audit log", () => {
  it("gets one entry, with ids only, for each give and each withdrawal", async () => {
    const h = await createHarness();
    const document = await publishMessages(h);
    const account = await h.seed.member();
    const member = await h.signIn(account, {
      ip: "198.51.100.44",
      userAgent: "Consent browser",
    });

    await h
      .as(member)
      .giveConsent({ purpose: "messages", documentId: document.id });
    await h.as(member).withdrawConsent({ purpose: "messages" });

    const events = await h.db
      .select()
      .from(consentEvent)
      .orderBy(consentEvent.id);
    const entries = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityType, "consent_event"))
      .orderBy(auditLog.id);
    const expected = (action: string, eventId: string | undefined) => ({
      id: expect.any(String),
      occurredAt: h.clock.now(),
      actorKind: "user",
      actorUserId: account.id,
      actorProcess: null,
      actorRole: null,
      action,
      entityType: "consent_event",
      entityId: eventId,
      before: null,
      after: {
        consentEventId: eventId,
        subjectType: "user",
        subjectId: account.id,
        purpose: "messages",
        documentId: document.id,
      },
      ip: "198.51.100.44",
      userAgent: "Consent browser",
    });
    expect(entries).toEqual([
      expected("consent.given", events[0]?.id),
      expected("consent.withdrawn", events[1]?.id),
    ]);
  });
});

describe("the consent.withdrawn event", () => {
  it("is saved with the withdrawal, holds ids only, and drains", async () => {
    const h = await createHarness();
    const document = await publishMessages(h);
    const account = await h.seed.member();
    const member = await h.signIn(account);
    await h.drain();

    await h
      .as(member)
      .giveConsent({ purpose: "messages", documentId: document.id });
    expect(await h.db.select().from(outbox)).toEqual([]);
    await h.as(member).withdrawConsent({ purpose: "messages" });

    const [withdrawal] = await h.db
      .select()
      .from(consentEvent)
      .where(eq(consentEvent.action, "withdrawn"));
    const rows = await h.db.select().from(outbox);
    expect(rows).toEqual([
      expect.objectContaining({
        eventType: "consent.withdrawn",
        aggregateType: "consent_event",
        aggregateId: withdrawal?.id,
        payload: {
          consentEventId: withdrawal?.id,
          subjectType: "user",
          subjectId: account.id,
          purpose: "messages",
          documentId: document.id,
        },
        status: "pending",
        occurredAt: h.clock.now(),
      }),
    ]);

    expect(await h.drain()).toMatchObject({ dispatched: 1, failed: 0 });
    expect((await h.db.select().from(outbox)).map((row) => row.status)).toEqual(
      ["dispatched"]
    );
  });

  it("is not saved when the withdrawal fails after emitting it", async () => {
    const h = await createHarness();
    const document = await publishMessages(h);
    const member = await h.signIn(await h.seed.member());
    await h.drain();
    await h
      .as(member)
      .giveConsent({ purpose: "messages", documentId: document.id });
    // Make the withdrawal's last write, its audit entry, fail.
    await h.db.execute(sql`
      create function fail_withdrawal_audit() returns trigger
      language plpgsql as $$
      begin
        if new.action = 'consent.withdrawn' then
          raise exception 'audit write failed';
        end if;
        return new;
      end;
      $$`);
    await h.db.execute(sql`
      create trigger fail_withdrawal_audit before insert on audit_log
      for each row execute function fail_withdrawal_audit()`);

    await expect(
      h.as(member).withdrawConsent({ purpose: "messages" })
    ).rejects.toThrow();

    const [events] = await h.db.select({ n: count() }).from(consentEvent);
    expect(events?.n).toBe(1);
    expect(await h.db.select().from(outbox)).toEqual([]);
    expect((await h.as(member).myConsents())[0]?.state.status).toBe("given");
  });
});

async function rowCounts(h: Harness) {
  const [events] = await h.db.select({ n: count() }).from(consentEvent);
  const [entries] = await h.db
    .select({ n: count() })
    .from(auditLog)
    .where(eq(auditLog.entityType, "consent_event"));
  const [deliveries] = await h.db.select({ n: count() }).from(outbox);
  return {
    events: events?.n,
    auditEntries: entries?.n,
    outboxRows: deliveries?.n,
  };
}

describe("calls that change nothing", () => {
  it("add no rows: giving again on the same version, withdrawing twice or before giving", async () => {
    const h = await createHarness();
    const document = await publishMessages(h);
    const member = await h.signIn(await h.seed.member());
    await h.drain();
    const give = { purpose: "messages", documentId: document.id } as const;

    expect(await h.as(member).withdrawConsent({ purpose: "messages" })).toEqual(
      { ok: true, changed: false }
    );
    expect(await rowCounts(h)).toEqual({
      events: 0,
      auditEntries: 0,
      outboxRows: 0,
    });

    await h.as(member).giveConsent(give);
    expect(await h.as(member).giveConsent(give)).toEqual({
      ok: true,
      changed: false,
    });
    await h.as(member).withdrawConsent({ purpose: "messages" });
    expect(await h.as(member).withdrawConsent({ purpose: "messages" })).toEqual(
      { ok: true, changed: false }
    );

    expect(await rowCounts(h)).toEqual({
      events: 2,
      auditEntries: 2,
      outboxRows: 1,
    });
  });

  it("refuses a stale version, and records a new give once version 2 is out", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());
    const unpublished = "01938a00-0000-7000-8000-0000000000ff";

    expect(
      await h
        .as(member)
        .giveConsent({ purpose: "messages", documentId: unpublished })
    ).toEqual({ ok: false, error: "no_published_document" });

    const v1 = await publishMessages(h, "Version one");
    await h.as(member).giveConsent({ purpose: "messages", documentId: v1.id });
    const v2 = await publishMessages(h, "Version two");
    const before = await rowCounts(h);

    expect(
      await h.as(member).giveConsent({ purpose: "messages", documentId: v1.id })
    ).toEqual({ ok: false, error: "document_outdated" });
    expect(await rowCounts(h)).toEqual(before);

    h.clock.advance({ minutes: 1 });
    expect(
      await h.as(member).giveConsent({ purpose: "messages", documentId: v2.id })
    ).toEqual({ ok: true, changed: true });
    const [messages] = await h.as(member).myConsents();
    expect(messages?.state).toEqual({
      status: "given",
      documentId: v2.id,
      documentVersion: 2,
      since: h.clock.now(),
    });
    expect(messages?.history.map((item) => item.documentVersion)).toEqual([
      2, 1,
    ]);
  });

  it("refuses a visitor", async () => {
    const h = await createHarness();
    const document = await publishMessages(h);
    const visitor = h.visitor();

    await expect(
      h
        .as(visitor)
        .giveConsent({ purpose: "messages", documentId: document.id })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      h.as(visitor).withdrawConsent({ purpose: "messages" })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(h.as(visitor).myConsents()).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
