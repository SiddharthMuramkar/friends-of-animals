// #115a: the grievance officer works a request through the transition
// table: assign, start, note, refuse, complete a correction. Each step
// writes one audit row holding no personal data, and the requester hears
// of a refusal and a completion.

import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog, privacyRequestNote } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { privacyRequestAuditSchema } from "./domain/audit";
import { memberWithRequest, requestRows, signedInOfficer } from "./testing";

/** Audit JSON of a request parses with its strict schema: no free text. */
function privacyRequestAuditSchemaCheck(value: unknown) {
  if (value !== null) privacyRequestAuditSchema.parse(value);
}

async function auditActions(h: Harness, requestId: string) {
  const rows = await h.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityId, requestId))
    .orderBy(asc(auditLog.id));
  for (const row of rows) {
    privacyRequestAuditSchemaCheck(row.before);
    privacyRequestAuditSchemaCheck(row.after);
  }
  return rows.map((row) => row.action);
}

describe("assignPrivacyRequest", () => {
  it("gives a new request to another officer and starts it; again changes nothing", async () => {
    const h = await createHarness();
    const me = await signedInOfficer(h);
    const colleague = await signedInOfficer(h, { name: "Hari Officer" });
    const filed = await memberWithRequest(h);

    expect(
      await h.as(me.actor).assignPrivacyRequest({
        id: filed.requestId,
        assigneeUserId: colleague.id,
      })
    ).toEqual({ ok: true, changed: true, status: "in_progress" });
    expect(
      await h.as(me.actor).assignPrivacyRequest({
        id: filed.requestId,
        assigneeUserId: colleague.id,
      })
    ).toEqual({ ok: true, changed: false, status: "in_progress" });
    // Reassigning keeps it in progress.
    expect(
      await h.as(me.actor).assignPrivacyRequest({
        id: filed.requestId,
        assigneeUserId: me.id,
      })
    ).toEqual({ ok: true, changed: true, status: "in_progress" });

    expect(await requestRows(h)).toEqual([
      expect.objectContaining({
        status: "in_progress",
        assignedToUserId: me.id,
        startedAt: h.clock.now(),
      }),
    ]);
    expect(await auditActions(h, filed.requestId)).toEqual([
      "privacy_request.submitted",
      "privacy_request.assigned",
      "privacy_request.assigned",
    ]);
  });

  it("refuses an assignee who isn't a grievance officer", async () => {
    const h = await createHarness();
    const me = await signedInOfficer(h);
    const filed = await memberWithRequest(h);
    const admin = await h.seed.superAdmin();

    expect(
      await h.as(me.actor).assignPrivacyRequest({
        id: filed.requestId,
        assigneeUserId: admin.id,
      })
    ).toEqual({ ok: false, error: "assignee_not_officer" });
    expect((await requestRows(h))[0]?.status).toBe("submitted");
  });
});

describe("startPrivacyRequest", () => {
  it("takes a new request, and refuses one already started", async () => {
    const h = await createHarness();
    const me = await signedInOfficer(h);
    const filed = await memberWithRequest(h);

    expect(
      await h.as(me.actor).startPrivacyRequest({ id: filed.requestId })
    ).toEqual({ ok: true, status: "in_progress" });
    expect(
      await h.as(me.actor).startPrivacyRequest({ id: filed.requestId })
    ).toEqual({ ok: false, error: "already_started" });
    expect((await requestRows(h))[0]?.assignedToUserId).toBe(me.id);
  });
});

describe("addPrivacyRequestNote", () => {
  it("keeps notes encrypted, in order, and off the requester's view and the audit log", async () => {
    const h = await createHarness();
    const me = await signedInOfficer(h, { name: "Gita Officer" });
    const filed = await memberWithRequest(h);

    await h.as(me.actor).addPrivacyRequestNote({
      id: filed.requestId,
      body: "Called the parent",
    });
    await h
      .as(me.actor)
      .addPrivacyRequestNote({ id: filed.requestId, body: "ID checked" });

    const view = await h
      .as(me.actor)
      .getGrievanceRequest({ id: filed.requestId });
    if (!view.ok) throw new Error("expected the request");
    expect(view.request.notes).toEqual([
      expect.objectContaining({
        body: "Called the parent",
        author: { id: me.id, name: "Gita Officer" },
      }),
      expect.objectContaining({ body: "ID checked" }),
    ]);
    const stored = await h.db.select().from(privacyRequestNote);
    expect(JSON.stringify(stored)).not.toContain("Called the parent");
    const audit = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "privacy_request.note_added"))
      .orderBy(asc(auditLog.id));
    expect(audit.map((row) => row.after)).toEqual([
      expect.objectContaining({ notes: 1 }),
      expect.objectContaining({ notes: 2 }),
    ]);
    expect(JSON.stringify(audit)).not.toContain("Called");
    const requesterView = await h
      .as(filed.actor)
      .getMyPrivacyRequest({ id: filed.requestId });
    expect(JSON.stringify(requesterView)).not.toContain("Called the parent");
  });

  it("refuses an empty note and a note longer than 2,000 characters", async () => {
    const h = await createHarness();
    const me = await signedInOfficer(h);
    const filed = await memberWithRequest(h);
    for (const body of ["  ", "x".repeat(2001)]) {
      expect(
        await h
          .as(me.actor)
          .addPrivacyRequestNote({ id: filed.requestId, body })
      ).toMatchObject({ ok: false, error: "invalid_input", fields: ["body"] });
    }
  });
});

describe("rejectPrivacyRequest", () => {
  it("refuses a request with a reason the requester reads and is told of", async () => {
    const h = await createHarness();
    const me = await signedInOfficer(h);
    const filed = await memberWithRequest(h, "erasure");
    await h.drain();

    expect(
      await h.as(me.actor).rejectPrivacyRequest({
        id: filed.requestId,
        reason: "We couldn't confirm who you are",
      })
    ).toEqual({ ok: true, status: "rejected" });
    await h.drain();

    expect(
      await h.as(filed.actor).getMyPrivacyRequest({ id: filed.requestId })
    ).toMatchObject({
      status: "rejected",
      rejectionReason: "We couldn't confirm who you are",
      closedAt: h.clock.now(),
    });
    const email = h.email.lastTo(filed.account.email);
    expect(email?.subject).toBe(
      `About your privacy request ${filed.reference}`
    );
    expect(email?.text).not.toContain("confirm who you are");
    expect(
      await h.as(me.actor).rejectPrivacyRequest({
        id: filed.requestId,
        reason: "Again",
      })
    ).toEqual({ ok: false, error: "request_closed" });
  });
});

describe("completeCorrection", () => {
  it("completes a started correction with what was corrected", async () => {
    const h = await createHarness();
    const me = await signedInOfficer(h);
    const filed = await memberWithRequest(h, "correction");
    await h.drain();

    expect(
      await h
        .as(me.actor)
        .completeCorrection({ id: filed.requestId, resolution: "Fixed" })
    ).toEqual({ ok: false, error: "not_started" });
    await h.as(me.actor).startPrivacyRequest({ id: filed.requestId });
    expect(
      await h.as(me.actor).completeCorrection({
        id: filed.requestId,
        resolution: "Your name now reads Asha Rao",
      })
    ).toEqual({ ok: true, status: "completed" });
    await h.drain();

    expect(
      await h.as(filed.actor).getMyPrivacyRequest({ id: filed.requestId })
    ).toMatchObject({
      status: "completed",
      resolution: "Your name now reads Asha Rao",
    });
    expect(h.email.lastTo(filed.account.email)?.subject).toBe(
      `Your privacy request ${filed.reference} is done`
    );
    expect(await auditActions(h, filed.requestId)).toEqual([
      "privacy_request.submitted",
      "privacy_request.started",
      "privacy_request.completed",
    ]);
  });

  it("leaves access and erasure requests to their export and erasure", async () => {
    const h = await createHarness();
    const me = await signedInOfficer(h);
    for (const type of ["access", "erasure"] as const) {
      const filed = await memberWithRequest(h, type);
      await h.as(me.actor).startPrivacyRequest({ id: filed.requestId });
      expect(
        await h
          .as(me.actor)
          .completeCorrection({ id: filed.requestId, resolution: "Done" })
      ).toEqual({ ok: false, error: "completed_by_export_or_erasure" });
    }
  });
});

describe("the officer's steps: who may take them", () => {
  it("refuses everyone but a grievance officer, writing nothing", async () => {
    const h = await createHarness();
    const filed = await memberWithRequest(h, "correction");
    const officer = await signedInOfficer(h);
    const outsiders: [string, Actor][] = [];
    for (const role of ["staff_admin", "super_admin", "finance"] as const) {
      const account = await h.seed.member({ email: `${role}@example.test` });
      await h.seed.grant(account, { role, scope: { type: "global" } });
      outsiders.push([role, await h.signIn(account)]);
    }
    outsiders.push(["requester", filed.actor], ["visitor", h.visitor()]);

    for (const [who, actor] of outsiders) {
      const as = h.as(actor);
      for (const step of [
        () => as.startPrivacyRequest({ id: filed.requestId }),
        () =>
          as.assignPrivacyRequest({
            id: filed.requestId,
            assigneeUserId: officer.id,
          }),
        () => as.addPrivacyRequestNote({ id: filed.requestId, body: "x" }),
        () => as.rejectPrivacyRequest({ id: filed.requestId, reason: "x" }),
        () => as.completeCorrection({ id: filed.requestId, resolution: "x" }),
      ]) {
        await expect(step(), who).rejects.toMatchObject({
          name: "DomainError",
          code: "forbidden",
        });
      }
    }
    expect(await auditActions(h, filed.requestId)).toEqual([
      "privacy_request.submitted",
    ]);
    expect((await requestRows(h))[0]?.status).toBe("submitted");
    expect(await h.db.select().from(privacyRequestNote)).toEqual([]);
  });
});
