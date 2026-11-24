import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import {
  auditLog,
  capturedMessage,
  contactMessage,
  contactNote,
  guardianInvitation,
  institutionInvitation,
  outbox,
  participantProfile,
  safeguardingIncidentLog,
  safeguardingReport,
  session,
  user,
} from "@/server/db/schema";
import * as schema from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { SCHEDULES } from "@/server/outbox/schedules";
import {
  bornYearsAgo,
  verifiedGuardian,
} from "@/server/modules/guardians/testing";
import { INVITATION_TTL_MS } from "@/server/modules/institutions/domain/invitation";
import {
  adultForm,
  openToIndividuals,
  signInMember,
} from "@/server/modules/participants/testing";
import {
  CONCERN,
  fileReport,
  signInLead,
} from "@/server/modules/safeguarding/testing";
import { createMigratedClient, createTestDb } from "@/test/db";
import { solvedHumanCheck } from "@/test/human-check";
import { createHarness, type Harness } from "@/test/harness";
import { INVITATION_LINK, seedInstitution } from "@/test/institutions";

import { retentionRunAuditSchema } from "./domain/retention-plan";
import { SWEEP_BATCH } from "./sweep";

const WORKER: Actor = { kind: "system", process: "worker" };

function sessionIdOf(actor: Actor): string {
  if (actor.kind !== "user") throw new Error("not signed in");
  return actor.sessionId;
}

async function sessionIds(h: Harness): Promise<string[]> {
  const rows = await h.db.select({ id: session.id }).from(session);
  return rows.map((row) => row.id).sort();
}

/** The audit rows of every retention run so far, oldest first. */
async function retentionRuns(h: Harness) {
  const rows = await h.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, "privacy.retention_run"))
    .orderBy(auditLog.id);
  return rows;
}

/** The counts the latest run recorded for `policy`. */
async function lastCounts(h: Harness, policy: string) {
  const runs = await retentionRuns(h);
  const summary = retentionRunAuditSchema.parse(runs.at(-1)?.after);
  return summary.policies[policy];
}

/** Whether the latest run changed nothing at all. */
async function lastRunWasEmpty(h: Harness): Promise<boolean> {
  const runs = await retentionRuns(h);
  const summary = retentionRunAuditSchema.parse(runs.at(-1)?.after);
  return Object.values(summary.policies).every(
    (counts) => counts.deleted === 0 && counts.anonymised === 0
  );
}

/** Lets the sweep delete and anonymise, as a super admin would. */
async function enforce(h: Harness) {
  await h.settings.set("retention.enforce", true);
}

/**
 * A member signed in twice, a second apart, then the clock moved to 30
 * days after the first session expired: that one's period is over, the
 * other's ends a second later.
 */
async function sessionsAtTheBoundary(h: Harness) {
  const member = await h.seed.member();
  const expired = await h.signIn(member);
  h.clock.advance({ seconds: 1 });
  h.cookies.clear();
  const kept = await h.signIn(member);
  // Sessions last 30 days; the policy keeps an expired one 30 more.
  h.clock.advance({ days: 60, seconds: -1 });
  return { member, expired, kept };
}

/** A message captured instead of sent, as local runs and previews do. */
async function captured(h: Harness, to: string) {
  const id = uuidv7(h.clock.now());
  await h.db.insert(capturedMessage).values({
    id,
    channel: "email",
    toAddress: to,
    subject: "Your sign-in code",
    bodyText: "Your code is 123456",
    createdAt: h.clock.now(),
  });
  return id;
}

async function capturedIds(h: Harness) {
  const rows = await h.db
    .select({ id: capturedMessage.id })
    .from(capturedMessage);
  return rows.map((row) => row.id).sort();
}

const retentionSchedule = () =>
  SCHEDULES.find((schedule) => schedule.name === "privacy.retention_sweep");

describe("runRetentionSweep", () => {
  it("deletes a session 30 days after it expired, not a second sooner", async () => {
    const h = await createHarness();
    await enforce(h);
    const { kept } = await sessionsAtTheBoundary(h);

    await h.as(WORKER).runRetentionSweep();

    expect(await sessionIds(h)).toEqual([sessionIdOf(kept)]);
  });

  it.each([
    ["session", "expiredSessions", 30],
    ["verification", "expiredVerifications", 1],
  ] as const)(
    "pages expired %s rows with a bounded expiry index and a stable tie break",
    async (table, policy, days) => {
      const { $client: client } = await createTestDb();
      const scans: { query: string; params: unknown[] }[] = [];
      const db = drizzle({
        client,
        schema,
        logger: {
          logQuery(query, params) {
            if (
              query.includes(`from "${table}"`) &&
              query.endsWith("for update")
            )
              scans.push({ query, params });
          },
        },
      });
      const h = await createHarness({ db });
      const member = await h.seed.member();
      const cutoff = new Date(h.clock.now().getTime() - days * 86_400_000);
      const records = sql`
        SELECT gen_random_uuid(), ${table === "session" ? sql`${member.id}::uuid,` : sql`'synthetic-code',`}
          'fixture-' || n,
          ${cutoff.toISOString()}::timestamptz + CASE
            WHEN n <= ${SWEEP_BATCH} THEN interval '-1 microsecond'
            WHEN n = ${SWEEP_BATCH + 1} THEN interval '0'
            ELSE interval '1 microsecond'
          END, now(), now()
        FROM generate_series(1, ${SWEEP_BATCH + 2}) AS n`;
      if (table === "session") {
        await db.execute(
          sql`INSERT INTO session (id, user_id, token, expires_at, created_at, updated_at) ${records}`
        );
      } else {
        await db.execute(
          sql`INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at) ${records}`
        );
      }
      await client.exec(`ANALYZE "${table}"`);

      const dryRun = await h.as(WORKER).runRetentionSweep();
      expect(dryRun.policies[policy]).toMatchObject({
        deleted: SWEEP_BATCH + 1,
      });
      expect(scans).toHaveLength(2);
      await client.exec("SET enable_seqscan = off");
      for (const [page, { query, params }] of scans.entries()) {
        const explained = await client.query<{ "QUERY PLAN": string }>(
          `EXPLAIN (COSTS OFF) ${query}`,
          params
        );
        const plan = explained.rows.map((row) => row["QUERY PLAN"]).join("\n");
        expect(plan).toContain(`Index Scan using ${table}_expires_at_id_idx`);
        expect(plan).toContain("Index Cond:");
        if (page > 0) expect(plan).toContain("ROW(expires_at, id) >");
      }
    }
  );

  it("only counts while retention is off: nothing goes, and the run is audited as a dry run", async () => {
    const h = await createHarness();
    await sessionsAtTheBoundary(h);
    const before = await sessionIds(h);

    const summary = await h.as(WORKER).runRetentionSweep();

    expect(await sessionIds(h)).toEqual(before);
    expect(summary.dryRun).toBe(true);
    expect(summary.policies.expiredSessions).toEqual({
      deleted: 1,
      anonymised: 0,
      held: 0,
      retainedByFloor: 0,
    });
    const [run] = await retentionRuns(h);
    expect(run?.after).toEqual(summary);
  });

  it("is the platform's own: a super admin, a staff admin and a member are refused, and nothing is written", async () => {
    const h = await createHarness();
    await enforce(h);
    const superAdmin = await h.signIn(await h.seed.superAdmin());
    const staffAdmin = await h.seed.member();
    await h.seed.grant(staffAdmin, {
      role: "staff_admin",
      scope: { type: "global" },
    });
    const staff = await h.signIn(staffAdmin);
    const member = await h.signIn(await h.seed.member());
    h.clock.advance({ days: 61 });
    const before = await sessionIds(h);

    for (const actor of [superAdmin, staff, member]) {
      await expect(h.as(actor).runRetentionSweep()).rejects.toMatchObject({
        code: "forbidden",
      });
    }

    expect(await sessionIds(h)).toEqual(before);
    expect(await retentionRuns(h)).toEqual([]);
  });

  it("also runs from the command line", async () => {
    const h = await createHarness();
    await enforce(h);
    await sessionsAtTheBoundary(h);

    const summary = await h
      .as({ kind: "system", process: "cli" })
      .runRetentionSweep();

    expect(summary.policies.expiredSessions?.deleted).toBe(1);
  });
});

describe("previewRetentionSweep", () => {
  it("shows a super admin what a run would remove, removes nothing, and audits the preview", async () => {
    const h = await createHarness();
    await enforce(h);
    await sessionsAtTheBoundary(h);
    h.cookies.clear();
    const admin = await h.signIn(await h.seed.superAdmin(), {
      ip: "203.0.113.42",
      userAgent: "Retention preview test browser",
    });
    const before = await sessionIds(h);

    const preview = await h.as(admin).previewRetentionSweep();

    expect(preview.dryRun).toBe(true);
    expect(preview.policies.expiredSessions?.deleted).toBe(1);
    expect(await sessionIds(h)).toEqual(before);
    const runs = await retentionRuns(h);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      actorKind: "user",
      actorRole: "super_admin",
      ip: null,
      userAgent: null,
      after: preview,
    });
  });

  it("is for a super admin: a staff admin, finance and a member are refused, and nothing is written", async () => {
    const h = await createHarness();
    const refused: Actor[] = [];
    for (const role of ["staff_admin", "finance"] as const) {
      const person = await h.seed.member();
      await h.seed.grant(person, { role, scope: { type: "global" } });
      h.cookies.clear();
      refused.push(await h.signIn(person));
    }
    h.cookies.clear();
    refused.push(await h.signIn(await h.seed.member()));

    for (const actor of refused) {
      await expect(h.as(actor).previewRetentionSweep()).rejects.toMatchObject({
        code: "forbidden",
      });
    }
    expect(await retentionRuns(h)).toEqual([]);
  });
});

describe("the privacy.retention_sweep schedule", () => {
  it("runs every day at 02:15 IST in the worker", () => {
    expect(retentionSchedule()).toMatchObject({
      name: "privacy.retention_sweep",
      cron: "15 2 * * *",
      tz: "Asia/Kolkata",
    });
  });

  it("deletes expired rows and clears expired links, leaving fresh ones, then finds nothing more", async () => {
    const h = await createHarness();
    await enforce(h);
    const { institution, admin } = await seedInstitution(h);
    const actor = await h.signIn(admin);
    const old = await captured(h, "old@example.test");
    const lapsed = await h.as(actor).inviteCoordinator({
      institutionId: institution.id,
      identifier: "lapsed@school.test",
    });
    await h.drain();
    // The link lapses after 7 days; a day later the sweep clears it. The
    // captured message is 30 days old a day before that.
    h.clock.advance({ milliseconds: INVITATION_TTL_MS, days: 24 });
    h.cookies.clear();
    const again = await h.signIn(admin);
    const fresh = await captured(h, "fresh@example.test");
    const waiting = await h.as(again).inviteCoordinator({
      institutionId: institution.id,
      identifier: "waiting@school.test",
    });
    await h.drain();
    if (!lapsed.ok || !waiting.ok) throw new Error("not invited");

    await retentionSchedule()!.run(h.deps);
    await h.drain();

    expect(await capturedIds(h)).toEqual([fresh]);
    expect(await capturedIds(h)).not.toContain(old);
    const links = await h.db
      .select({
        id: institutionInvitation.id,
        status: institutionInvitation.status,
        token: institutionInvitation.tokenCiphertext,
      })
      .from(institutionInvitation);
    expect(links).toEqual(
      expect.arrayContaining([
        { id: lapsed.invitationId, status: "pending", token: null },
        {
          id: waiting.invitationId,
          status: "pending",
          token: expect.any(String),
        },
      ])
    );
    expect(await lastCounts(h, "capturedMessages")).toMatchObject({
      deleted: 1,
    });
    expect(await lastCounts(h, "coordinatorInvitationLinks")).toMatchObject({
      anonymised: 1,
    });

    await retentionSchedule()!.run(h.deps);

    expect(await capturedIds(h)).toEqual([fresh]);
    expect(await retentionRuns(h)).toHaveLength(2);
    expect(await lastRunWasEmpty(h)).toBe(true);
  });

  it("records each run as one audit row from the worker, with counts and nothing personal", async () => {
    const h = await createHarness();
    await enforce(h);
    const member = await h.seed.member({
      name: "Asha Rao",
      email: "asha@example.test",
      phone: "98765 43210",
    });
    await h.signIn(member);
    h.clock.advance({ days: 61 });

    await retentionSchedule()!.run(h.deps);

    const runs = await retentionRuns(h);
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run).toMatchObject({
      actorKind: "system",
      actorProcess: "worker",
      actorUserId: null,
      entityType: "retention_run",
      before: null,
      ip: null,
      userAgent: null,
    });
    const summary = retentionRunAuditSchema.parse(run?.after);
    expect(summary.dryRun).toBe(false);
    expect(summary.policies.expiredSessions?.deleted).toBe(1);
    const recorded = JSON.stringify(run?.after);
    expect(recorded).not.toMatch(/asha|rao|@|98765|43210/i);
    expect(recorded).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
  });

  it("audits committed counts when a later policy fails and keeps them across a retry", async () => {
    const h = await createHarness();
    await enforce(h);
    const memberSession = await h.signIn(await h.seed.member());
    const messageId = await captured(h, "retention@example.test");
    h.clock.advance({ days: 61 });
    await h.db.execute(sql`CREATE TABLE retention_test_blocker (
      message_id uuid REFERENCES captured_message(id)
    )`);
    await h.db.execute(
      sql`INSERT INTO retention_test_blocker VALUES (${messageId})`
    );

    await expect(retentionSchedule()!.run(h.deps)).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "23503" }),
    });
    expect(await sessionIds(h)).not.toContain(sessionIdOf(memberSession));
    expect(await capturedIds(h)).toEqual([messageId]);
    expect(await retentionRuns(h)).toHaveLength(1);
    expect(await lastCounts(h, "expiredSessions")).toMatchObject({
      deleted: 1,
    });
    expect(await lastCounts(h, "capturedMessages")).toBeUndefined();

    await h.db.execute(sql`DELETE FROM retention_test_blocker`);
    await retentionSchedule()!.run(h.deps);
    expect(await capturedIds(h)).toEqual([]);
    expect(await retentionRuns(h)).toHaveLength(2);
    expect(await lastCounts(h, "expiredSessions")).toMatchObject({
      deleted: 0,
    });
    expect(await lastCounts(h, "capturedMessages")).toMatchObject({
      deleted: 1,
    });
  });

  it("recovers committed counts when the database could not finish the run's audit", async () => {
    const h = await createHarness();
    await enforce(h);
    const memberSession = await h.signIn(await h.seed.member());
    h.clock.advance({ days: 61 });
    await h.db
      .execute(sql`CREATE FUNCTION retention_test_reject_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit unavailable'; END; $$`);
    await h.db
      .execute(sql`CREATE TRIGGER retention_test_reject_audit BEFORE INSERT ON audit_log
      FOR EACH ROW WHEN (NEW.action = 'privacy.retention_run')
      EXECUTE FUNCTION retention_test_reject_audit()`);

    await expect(retentionSchedule()!.run(h.deps)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: "Audit unavailable" }),
    });
    expect(await sessionIds(h)).not.toContain(sessionIdOf(memberSession));
    expect(await retentionRuns(h)).toEqual([]);
    await h.db.execute(
      sql`DROP TRIGGER retention_test_reject_audit ON audit_log`
    );
    h.clock.advance({ hours: 2, seconds: 1 });

    await retentionSchedule()!.run(h.deps);
    const runs = await retentionRuns(h);
    expect(runs).toHaveLength(2);
    expect(
      retentionRunAuditSchema.parse(runs[0]?.after).policies.expiredSessions
    ).toMatchObject({ deleted: 1 });
    expect(await lastCounts(h, "expiredSessions")).toMatchObject({
      deleted: 0,
    });
  });
});

describe("the sweep's carried cases", () => {
  it("keeps a closed contact message and its notes while its sender is held", async () => {
    const h = await createHarness({ now: "2026-03-01T04:00:00Z" });
    await enforce(h);
    const sender = await h.seed.member();
    const visitor = h.visitor();
    expect(
      await h.as(visitor).submitContactMessage({
        topic: "GENERAL",
        name: "Asha Rao",
        email: ` ${sender.email.toUpperCase()} `,
        subject: "A question",
        message: "Words the sender wrote.",
        humanCheck: await solvedHumanCheck(h, visitor),
      })
    ).toMatchObject({ ok: true });
    const [{ id: messageId }] = await h.db
      .select({ id: contactMessage.id })
      .from(contactMessage);
    const admin = await h.seed.superAdmin();
    const app = h.as(await h.signIn(admin));
    expect(
      await app.addContactNote({ messageId, body: "Answered by phone." })
    ).toMatchObject({ ok: true });
    expect(
      await app.changeContactMessageStatus({
        messageId,
        status: "closed",
        closeReason: "resolved",
      })
    ).toMatchObject({ ok: true });
    const held = await app.placeLegalHold({
      subjectType: "user",
      subjectId: sender.id,
      reason: "Pending inquiry",
    });
    if (!held.ok) throw new Error(held.error);

    h.clock.set("2028-03-02T04:00:00Z");
    const worker = h.as(WORKER);
    expect(
      (await worker.runRetentionSweep()).policies.contactMessages
    ).toMatchObject({ deleted: 0, held: 1 });
    expect(await h.db.select().from(contactMessage)).toMatchObject([
      { id: messageId, email: sender.email },
    ]);
    expect(await h.db.select().from(contactNote)).toMatchObject([
      { messageId, body: "Answered by phone." },
    ]);
    expect(
      await h
        .as(await h.signIn(admin))
        .releaseLegalHold({ holdId: held.holdId })
    ).toEqual({ ok: true });
    expect(
      (await worker.runRetentionSweep()).policies.contactMessages
    ).toMatchObject({ deleted: 1, held: 0 });
    expect(await h.db.select().from(contactMessage)).toEqual([]);
    expect(await h.db.select().from(contactNote)).toEqual([]);
  });

  it("keeps an expired teen invitation and its link while the inviting guardian's account is held", async () => {
    const h = await createHarness();
    await enforce(h);
    const guardian = await verifiedGuardian(h, {
      name: "Sunita Rao",
      email: "parent@example.test",
    });
    const app = h.as(guardian.actor);
    const child = await app.addChild({
      fullName: "Arjun Rao",
      dateOfBirth: bornYearsAgo(h, 15),
      relationship: "parent",
    });
    if (!child.ok) throw new Error(child.error);
    const email = "teen@example.test";
    const invitation = await app.inviteTeenLogin({
      childId: child.childId,
      email,
    });
    if (!invitation.ok) throw new Error(invitation.error);
    await h.drain();
    const token = INVITATION_LINK.exec(h.email.lastTo(email)?.text ?? "")?.[1];
    if (!token) throw new Error("No teen invitation was sent");

    h.clock.advance({ days: 38 });
    const admin = h.as(await h.signIn(await h.seed.superAdmin()));
    const hold = await admin.placeLegalHold({
      subjectType: "user",
      subjectId: guardian.account.id,
      reason: "Pending inquiry",
    });
    if (!hold.ok) throw new Error(hold.error);
    const worker = h.as(WORKER);
    const held = await worker.runRetentionSweep();
    expect(held.policies).toMatchObject({
      guardianInvitationLinks: { anonymised: 0, held: 1 },
      guardianInvitations: { deleted: 0, held: 1 },
    });
    expect(await h.db.select().from(guardianInvitation)).toMatchObject([
      { id: invitation.invitationId, tokenCiphertext: expect.any(String) },
    ]);
    expect(await h.as(h.visitor()).viewTeenInvitation({ token })).toMatchObject(
      {
        invitation: { status: "expired" },
      }
    );

    expect(await admin.releaseLegalHold({ holdId: hold.holdId })).toEqual({
      ok: true,
    });
    const released = await worker.runRetentionSweep();
    expect(released.policies).toMatchObject({
      guardianInvitationLinks: { anonymised: 1, held: 0 },
      guardianInvitations: { deleted: 1, held: 0 },
    });
    expect(await h.db.select().from(guardianInvitation)).toEqual([]);
  });

  it.each(["email", "phone"] as const)(
    "keeps an expired pending coordinator invitation for a held %s invitee",
    async (channel) => {
      const h = await createHarness();
      await enforce(h);
      const { institution, admin: sender } = await seedInstitution(h);
      const invitee = await h.seed.member({
        email: "invitee@school.test",
        phone: "+919876543210",
      });
      await h.settings.set("sms.enabled", true);
      const invitation = await h.as(await h.signIn(sender)).inviteCoordinator({
        institutionId: institution.id,
        identifier: channel === "email" ? invitee.email : "+919876543210",
      });
      if (!invitation.ok) throw new Error(invitation.error);
      h.clock.advance({ days: 98 });
      const admin = h.as(await h.signIn(await h.seed.superAdmin()));
      const hold = await admin.placeLegalHold({
        subjectType: "user",
        subjectId: invitee.id,
        reason: "Pending inquiry",
      });
      if (!hold.ok) throw new Error(hold.error);
      const worker = h.as(WORKER);
      expect((await worker.runRetentionSweep()).policies).toMatchObject({
        coordinatorInvitationLinks: { anonymised: 0, held: 1 },
        coordinatorInvitations: { deleted: 0, held: 1 },
      });
      expect(await h.db.select().from(institutionInvitation)).toMatchObject([
        {
          id: invitation.invitationId,
          status: "pending",
          tokenCiphertext: expect.any(String),
        },
      ]);
      expect(await admin.releaseLegalHold({ holdId: hold.holdId })).toEqual({
        ok: true,
      });
      expect((await worker.runRetentionSweep()).policies).toMatchObject({
        coordinatorInvitationLinks: { anonymised: 1, held: 0 },
        coordinatorInvitations: { deleted: 1, held: 0 },
      });
      expect(await h.db.select().from(institutionInvitation)).toEqual([]);
    }
  );

  it.each(["institution.verified", "identity.user_signed_up"] as const)(
    "keeps an expired %s outbox event while its user is held",
    async (eventType) => {
      const h = await createHarness();
      await enforce(h);
      let subjectId: string;
      if (eventType === "institution.verified") {
        subjectId = (await seedInstitution(h)).admin.id;
      } else {
        const email = "new-member@example.test";
        const visitor = h.as(h.visitor());
        expect(
          await visitor.requestEmailCode({
            intent: "sign-up",
            name: "Asha Rao",
            email,
          })
        ).toEqual({ ok: true });
        const code = h.email.codeFor(email);
        if (!code) throw new Error("No sign-up code was sent");
        expect(
          await visitor.verifyEmailCode({
            intent: "sign-up",
            email,
            code,
            name: "Asha Rao",
          })
        ).toMatchObject({ ok: true });
        const actor = await h.currentActor();
        if (actor.kind !== "user") throw new Error("Expected a new member");
        subjectId = actor.userId;
        await h.drain();
      }
      const deliveries = () =>
        h.db.select().from(outbox).where(eq(outbox.eventType, eventType));
      const before = await deliveries();
      expect(before.length).toBeGreaterThan(0);
      expect(before.every(({ status }) => status === "dispatched")).toBe(true);
      h.clock.advance({ days: 31 });
      const admin = h.as(await h.signIn(await h.seed.superAdmin()));
      const hold = await admin.placeLegalHold({
        subjectType: "user",
        subjectId,
        reason: "Pending inquiry",
      });
      if (!hold.ok) throw new Error(hold.error);
      const worker = h.as(WORKER);
      expect(
        (await worker.runRetentionSweep()).policies.dispatchedOutbox?.held
      ).toBe(before.length);
      expect(await deliveries()).toEqual(before);

      expect(await admin.releaseLegalHold({ holdId: hold.holdId })).toEqual({
        ok: true,
      });
      expect(
        (await worker.runRetentionSweep()).policies.dispatchedOutbox
      ).toMatchObject({
        deleted: before.length,
        held: 0,
      });
      expect(await deliveries()).toEqual([]);
    }
  );

  it("keeps an accepted coordinator invitation while its invitee is on hold", async () => {
    const h = await createHarness();
    await enforce(h);
    const { institution, admin: institutionAdmin } = await seedInstitution(h);
    const invitee = await h.seed.member({ email: "invitee@school.test" });
    const invited = await h
      .as(await h.signIn(institutionAdmin))
      .inviteCoordinator({
        institutionId: institution.id,
        identifier: invitee.email,
      });
    if (!invited.ok) throw new Error(invited.error);
    await h.drain();
    const token = INVITATION_LINK.exec(
      h.email.lastTo(invitee.email)?.text ?? ""
    )?.[1];
    if (!token) throw new Error("No invitation link was sent");
    expect(
      await h.as(await h.signIn(invitee)).acceptInvitation({ token })
    ).toEqual({
      ok: true,
      institutionId: institution.id,
    });
    const admin = await h.seed.superAdmin();
    const hold = await h.as(await h.signIn(admin)).placeLegalHold({
      subjectType: "user",
      subjectId: invitee.id,
      reason: "Pending inquiry",
    });
    if (!hold.ok) throw new Error(hold.error);
    h.clock.advance({ days: 120 });

    const worker = h.as(WORKER);
    const held = await worker.runRetentionSweep();
    expect(held.policies.coordinatorInvitations).toMatchObject({
      deleted: 0,
      held: 1,
    });
    const invitations = () =>
      h.db
        .select()
        .from(institutionInvitation)
        .where(eq(institutionInvitation.id, invited.invitationId));
    expect(await invitations()).toMatchObject([
      { status: "accepted", acceptedByUserId: invitee.id },
    ]);

    expect(
      await h
        .as(await h.signIn(admin))
        .releaseLegalHold({ holdId: hold.holdId })
    ).toEqual({ ok: true });
    const released = await worker.runRetentionSweep();
    expect(released.policies.coordinatorInvitations).toMatchObject({
      deleted: 1,
      held: 0,
    });
    expect(await invitations()).toEqual([]);
  });

  it.each([
    ["foa", "before"],
    ["foa", "after"],
    ["staging", "before"],
    ["staging", "after"],
    ["nonprod", "before"],
  ] as const)(
    "gives only the %s retention worker parent deletion when provisioned %s migrations",
    async (prefix, provisioned) => {
      const appRole = `${prefix}_app`;
      const workerRole = `${prefix}_worker`;
      const client = await createMigratedClient({
        before: (empty) =>
          empty.exec(`
          CREATE ROLE ${appRole};
          ${provisioned === "before" ? `CREATE ROLE ${workerRole} IN ROLE ${appRole};` : ""}
          GRANT USAGE ON SCHEMA public TO ${appRole};
          ALTER DEFAULT PRIVILEGES IN SCHEMA public
            GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRole};
        `),
      });
      const h = await createHarness({
        db: drizzle({ client, schema }),
        now: "2026-03-01T04:00:00.000Z",
      });
      if (provisioned === "after") {
        await client.exec(`CREATE ROLE ${workerRole} IN ROLE ${appRole}`);
        const bootstrapName =
          prefix === "foa" ? "workers-prod" : "workers-nonprod";
        const database = prefix === "foa" ? "foa" : "foa_staging";
        const bootstrap = await readFile(
          `docker/postgres/bootstrap/${bootstrapName}.sql`,
          "utf8"
        );
        // PGlite already connects to the fixture database.
        const databaseSql = bootstrap.split(`\n\\connect ${database}\n`)[1];
        if (!databaseSql)
          throw new Error("Missing database-local worker bootstrap");
        await client.exec(databaseSql);
      }
      const privileges = await client.query(`SELECT
        has_table_privilege('${appRole}', 'public.safeguarding_report', 'DELETE') AS web_deletes_report,
        has_table_privilege('${appRole}', 'public.safeguarding_report', 'TRUNCATE') AS web_truncates_reports,
        has_table_privilege('${workerRole}', 'public.safeguarding_report', 'DELETE') AS worker_deletes_report,
        has_table_privilege('${workerRole}', 'public.safeguarding_incident_log', 'DELETE') AS worker_deletes_incident`);
      expect(privileges.rows).toEqual([
        {
          web_deletes_report: false,
          web_truncates_reports: false,
          worker_deletes_report: true,
          worker_deletes_incident: false,
        },
      ]);
      await client.exec(`SET ROLE ${appRole}`);
      await enforce(h);
      const reportId = await fileReport(h, { ...CONCERN, subjectAge: 17 });
      const lead = h.as((await signInLead(h)).actor);
      expect(
        await lead.moveSafeguardingReport({
          reportId,
          action: { event: "triage", severity: "low" },
        })
      ).toEqual({ ok: true, status: "triaged" });
      expect(
        await lead.moveSafeguardingReport({
          reportId,
          action: { event: "resolve", outcome: "Concern resolved" },
        })
      ).toEqual({ ok: true, status: "resolved" });
      const incidentRows = () =>
        h.db
          .select()
          .from(safeguardingIncidentLog)
          .where(eq(safeguardingIncidentLog.reportId, reportId));
      expect(await incidentRows()).toHaveLength(2);
      const visitor = h.visitor();
      const sent = await h.as(visitor).submitContactMessage({
        topic: "GENERAL",
        name: "Asha Rao",
        email: "asha@example.test",
        subject: "A question",
        message: "Words the sender wrote.",
        humanCheck: await solvedHumanCheck(h, visitor),
      });
      if (!sent.ok) throw new Error(sent.error);
      const [message] = await h.db
        .select({ id: contactMessage.id })
        .from(contactMessage);
      const author = await h.seed.member();
      const admin = await h.seed.superAdmin();
      // Closed and noted by staff: stored directly, since this is about
      // what retention removes, not how staff handle a message.
      await h.db
        .update(contactMessage)
        .set({
          status: "closed",
          closeReason: "resolved",
          closedAt: h.clock.now(),
        })
        .where(eq(contactMessage.id, message!.id));
      await h.db.insert(contactNote).values({
        id: uuidv7(h.clock.now()),
        messageId: message!.id,
        authorUserId: author.id,
        body: "Answered by phone.",
        createdAt: h.clock.now(),
      });
      const placed = await h.as(await h.signIn(admin)).placeLegalHold({
        subjectType: "user",
        subjectId: author.id,
        reason: "Pending inquiry",
      });
      if (!placed.ok) throw new Error(placed.error);

      await expect(client.query("DELETE FROM contact_note")).rejects.toThrow(
        "permission denied for table contact_note"
      );
      await expect(client.query("DELETE FROM contact_message")).rejects.toThrow(
        "permission denied for table contact_message"
      );
      await expect(
        client.query("UPDATE contact_note SET author_user_id = NULL")
      ).rejects.toThrow("permission denied for table contact_note");

      await client.exec(`SET ROLE ${workerRole}`);
      await expect(client.query("DELETE FROM contact_note")).rejects.toThrow(
        "permission denied for table contact_note"
      );

      // A leap day must not roll the cutoff into the next month two years back.
      h.clock.set("2028-02-29T04:00:05.000Z");
      await retentionSchedule()!.run(h.deps);
      expect(await h.db.select().from(contactMessage)).toHaveLength(1);
      expect(await h.db.select().from(contactNote)).toHaveLength(1);
      expect(await lastCounts(h, "contactMessages")).toMatchObject({ held: 0 });

      h.clock.set("2028-03-01T04:00:05.000Z");
      await retentionSchedule()!.run(h.deps);
      expect(await lastCounts(h, "contactMessages")).toMatchObject({ held: 1 });
      expect(await h.db.select().from(contactNote)).toHaveLength(1);

      await client.exec(`SET ROLE ${appRole}`);
      const app = h.as(await h.signIn(admin));
      expect(await app.releaseLegalHold({ holdId: placed.holdId })).toEqual({
        ok: true,
      });
      await client.exec(`SET ROLE ${workerRole}`);
      await retentionSchedule()!.run(h.deps);
      await h.drain();
      expect(await h.db.select().from(contactMessage)).toEqual([]);
      expect(await h.db.select().from(contactNote)).toEqual([]);
      expect(await lastCounts(h, "contactMessages")).toMatchObject({
        deleted: 1,
      });
      await expect(
        client.query("DELETE FROM safeguarding_incident_log")
      ).rejects.toThrow(
        "permission denied for table safeguarding_incident_log"
      );
      h.clock.set("2035-03-02T00:00:00Z");
      expect(
        (await h.as(WORKER).runRetentionSweep()).policies.safeguardingReports
      ).toMatchObject({ deleted: 1 });
      expect(
        await h.db
          .select()
          .from(safeguardingReport)
          .where(eq(safeguardingReport.id, reportId))
      ).toEqual([]);
      expect(await incidentRows()).toEqual([]);
    }
  );

  it("deletes a resolved safeguarding report past its date, with its incident log (#116)", async () => {
    const h = await createHarness({ now: "2026-01-10T04:00:00Z" });
    await enforce(h);
    await fileReport(
      h,
      { ...CONCERN, subjectAge: 17 },
      {
        status: "resolved",
        severity: "low",
        outcome: "Done",
        resolvedAt: h.clock.now(),
      }
    );
    const open = await fileReport(h);

    h.clock.set(new Date("2034-01-11T00:00:00Z"));
    await h.as(WORKER).runRetentionSweep();

    const reports = await h.db
      .select({ id: safeguardingReport.id })
      .from(safeguardingReport);
    expect(reports).toEqual([{ id: open }]);
    const logs = await h.db
      .select({ report: safeguardingIncidentLog.reportId })
      .from(safeguardingIncidentLog);
    expect(logs.every((log) => log.report === open)).toBe(true);
  });

  it.each(["assignee", "author"] as const)(
    "keeps an expired safeguarding report and log while its %s is on hold",
    async (heldSubject) => {
      const h = await createHarness({ now: "2026-01-10T04:00:00Z" });
      await enforce(h);
      const reportId = await fileReport(h, { ...CONCERN, subjectAge: 17 });
      const assignee = await signInLead(h);
      const author = await signInLead(h);
      const lead = h.as(author.actor);
      expect(
        await lead.assignSafeguardingReport({
          reportId,
          assigneeUserId: assignee.id,
        })
      ).toEqual({ ok: true, changed: true });
      expect(
        await lead.moveSafeguardingReport({
          reportId,
          action: { event: "triage", severity: "low" },
        })
      ).toEqual({ ok: true, status: "triaged" });
      expect(
        await lead.moveSafeguardingReport({
          reportId,
          action: { event: "resolve", outcome: "Concern addressed" },
        })
      ).toEqual({ ok: true, status: "resolved" });

      const admin = await h.seed.superAdmin();
      const hold = await h.as(await h.signIn(admin)).placeLegalHold({
        subjectType: "user",
        subjectId: (heldSubject === "assignee" ? assignee : author).id,
        reason: "Pending inquiry",
      });
      if (!hold.ok) throw new Error(hold.error);
      h.clock.set("2034-01-11T00:00:00Z");

      const worker = h.as(WORKER);
      const held = await worker.runRetentionSweep();
      expect(held.policies.safeguardingReports).toMatchObject({
        deleted: 0,
        held: 1,
      });
      const reports = () =>
        h.db
          .select()
          .from(safeguardingReport)
          .where(eq(safeguardingReport.id, reportId));
      const logs = () =>
        h.db
          .select()
          .from(safeguardingIncidentLog)
          .where(eq(safeguardingIncidentLog.reportId, reportId));
      expect(await reports()).toMatchObject([
        { assignedToUserId: assignee.id },
      ]);
      expect(await logs()).toMatchObject([
        { authorUserId: author.id },
        { authorUserId: author.id },
      ]);

      expect(
        await h
          .as(await h.signIn(admin))
          .releaseLegalHold({ holdId: hold.holdId })
      ).toEqual({ ok: true });
      const released = await worker.runRetentionSweep();
      expect(released.policies.safeguardingReports).toMatchObject({
        deleted: 1,
        held: 0,
      });
      expect(await reports()).toEqual([]);
      expect(await logs()).toEqual([]);
    }
  );

  it("reads bounded pages of safeguarding reports and continues past ineligible and held pages", async () => {
    const { $client: client } = await createTestDb();
    const reportReads: string[] = [];
    const h = await createHarness({
      db: drizzle({
        client,
        schema,
        logger: {
          logQuery(query) {
            if (/^select .* from "safeguarding_report"/i.test(query)) {
              reportReads.push(query);
            }
          },
        },
      }),
      now: "2026-01-10T04:00:00Z",
    });
    await enforce(h);
    const lead = await signInLead(h);
    const admin = await h.seed.superAdmin();
    expect(
      await h.as(await h.signIn(admin)).placeLegalHold({
        subjectType: "user",
        subjectId: lead.id,
        reason: "Pending inquiry",
      })
    ).toMatchObject({ ok: true });

    const first = await fileReport(
      h,
      { ...CONCERN, subjectAge: 1 },
      {
        status: "resolved",
        severity: "low",
        outcome: "Concern addressed",
        resolvedAt: h.clock.now(),
      }
    );
    const [example] = await h.db
      .select()
      .from(safeguardingReport)
      .where(eq(safeguardingReport.id, first));
    if (!example) throw new Error("Missing safeguarding fixture");
    const backlog = Array.from({ length: 2 * SWEEP_BATCH }, (_, index) => ({
      ...example,
      id: uuidv7(new Date(h.clock.now().getTime() + index)),
      reference: `SG-26-PAGE${index}`,
      subjectAge: index < SWEEP_BATCH - 1 ? 1 : 17,
      assignedToUserId:
        index >= SWEEP_BATCH - 1 && index < 2 * SWEEP_BATCH - 1
          ? lead.id
          : null,
    }));
    await h.db.insert(safeguardingReport).values(backlog);
    h.clock.set("2034-01-11T00:00:00Z");

    reportReads.length = 0;
    const summary = await h.as(WORKER).runRetentionSweep();
    expect(summary.policies.safeguardingReports).toMatchObject({
      deleted: 1,
      held: SWEEP_BATCH,
    });
    expect(reportReads).toHaveLength(3);
    expect(reportReads.every((query) => /\blimit \$\d+\b/i.test(query))).toBe(
      true
    );
    expect(
      await h.db
        .select({ id: safeguardingReport.id })
        .from(safeguardingReport)
        .where(eq(safeguardingReport.id, backlog.at(-1)!.id))
    ).toEqual([]);
  });

  it("deletes a child's profile its guardian left behind, but keeps an adult's with an entry (#78)", async () => {
    const h = await createHarness();
    await enforce(h);
    const family = await h.seed.guardian({
      children: [{ fullName: "Mira Rao", age: 9 }],
    });
    const competition = await openToIndividuals(h, { fee: 0n });
    const adult = await signInMember(h);
    const registered = await h
      .as(adult.actor)
      .registerAsIndividual(adultForm(competition));
    if (!registered.ok) throw new Error(JSON.stringify(registered));
    const before = await h.db
      .select({ id: participantProfile.id })
      .from(participantProfile);

    await h.db.delete(user).where(eq(user.id, family.account.id));
    await h.db.delete(user).where(eq(user.id, adult.userId));
    await h.as(WORKER).runRetentionSweep();

    const after = await h.db
      .select({ id: participantProfile.id })
      .from(participantProfile);
    expect(after).toHaveLength(before.length - 1);
    expect(after.map((row) => row.id)).not.toContain(family.childIds[0]);
    expect(await lastCounts(h, "orphanedProfiles")).toMatchObject({
      deleted: 1,
    });
  });
});
