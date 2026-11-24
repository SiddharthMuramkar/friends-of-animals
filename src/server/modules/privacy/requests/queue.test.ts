// #115a: the grievance officer's queue, with due dates, overdue flags and
// assignment, and the request page. Only a grievance officer opens it.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { memberWithRequest, signedInOfficer } from "./testing";

async function notOfficers(h: Harness): Promise<[string, Actor][]> {
  const actors: [string, Actor][] = [];
  for (const role of ["staff_admin", "super_admin", "finance"] as const) {
    const account = await h.seed.member({ email: `${role}@example.test` });
    await h.seed.grant(account, { role, scope: { type: "global" } });
    actors.push([role, await h.signIn(account)]);
  }
  actors.push(["member", await h.signIn(await h.seed.member())]);
  actors.push(["visitor", h.visitor()]);
  return actors;
}

describe("listGrievanceQueue", () => {
  it("lists open requests earliest due first, with days left and assignees", async () => {
    const h = await createHarness();
    const officer = await signedInOfficer(h, { name: "Gita Officer" });
    const first = await memberWithRequest(h, "access");
    h.clock.advance({ days: 2 });
    const second = await memberWithRequest(h, "erasure");
    await h.as(officer.actor).startPrivacyRequest({ id: second.requestId });

    const queue = await h.as(officer.actor).listGrievanceQueue();

    expect(queue).toMatchObject({ ok: true, more: false });
    if (!queue.ok) throw new Error("expected the queue");
    expect(queue.requests).toEqual([
      expect.objectContaining({
        reference: first.reference,
        type: "access",
        relation: "self",
        status: "submitted",
        daysLeft: 28,
        overdue: false,
        assignee: null,
      }),
      expect.objectContaining({
        reference: second.reference,
        status: "in_progress",
        daysLeft: 30,
        assignee: { id: officer.id, name: "Gita Officer" },
      }),
    ]);
  });

  it("flags open requests once their due time passes, never closed ones", async () => {
    const h = await createHarness();
    const officer = await signedInOfficer(h);
    const open = await memberWithRequest(h, "access");
    const refused = await memberWithRequest(h, "erasure");
    await h
      .as(officer.actor)
      .rejectPrivacyRequest({ id: refused.requestId, reason: "Duplicate" });

    h.clock.advance({ days: 31 });
    const queue = await h
      .as(officer.actor)
      .listGrievanceQueue({ status: "open" });
    const closed = await h
      .as(officer.actor)
      .listGrievanceQueue({ status: "closed" });

    if (!queue.ok || !closed.ok) throw new Error("expected the queue");
    expect(queue.requests).toEqual([
      expect.objectContaining({
        reference: open.reference,
        overdue: true,
        daysLeft: -1,
      }),
    ]);
    expect(closed.requests).toEqual([
      expect.objectContaining({
        reference: refused.reference,
        status: "rejected",
        overdue: false,
        daysLeft: null,
      }),
    ]);
  });

  it("filters by assignee and by type", async () => {
    const h = await createHarness();
    const me = await signedInOfficer(h, { name: "Gita Officer" });
    const colleague = await signedInOfficer(h, { name: "Hari Officer" });
    const mine = await memberWithRequest(h, "access");
    const theirs = await memberWithRequest(h, "correction");
    const nobodys = await memberWithRequest(h, "erasure");
    await h.as(me.actor).startPrivacyRequest({ id: mine.requestId });
    await h.as(me.actor).assignPrivacyRequest({
      id: theirs.requestId,
      assigneeUserId: colleague.id,
    });

    const references = async (filter: object) => {
      const result = await h.as(me.actor).listGrievanceQueue(filter);
      if (!result.ok) throw new Error("expected the queue");
      return result.requests.map((request) => request.reference);
    };

    expect(await references({ assignee: "me" })).toEqual([mine.reference]);
    expect(await references({ assignee: "unassigned" })).toEqual([
      nobodys.reference,
    ]);
    expect(await references({ assignee: colleague.id })).toEqual([
      theirs.reference,
    ]);
    expect(await references({ type: "erasure" })).toEqual([nobodys.reference]);
    expect(
      await h.as(me.actor).listGrievanceQueue({ assignee: "someone" })
    ).toMatchObject({ ok: false, error: "invalid_input" });
  });

  it("refuses everyone but a grievance officer, super admins included", async () => {
    const h = await createHarness();
    await memberWithRequest(h);
    for (const [who, actor] of await notOfficers(h)) {
      await expect(h.as(actor).listGrievanceQueue(), who).rejects.toMatchObject(
        { name: "DomainError", code: "forbidden" }
      );
    }
  });

  it("asks a grievance officer for their second factor first", async () => {
    const h = await createHarness();
    const account = await h.seed.member();
    await h.seed.grant(account, {
      role: "grievance_officer",
      scope: { type: "global" },
    });
    const actor = await h.signIn(account, {}, { secondFactor: false });

    await expect(h.as(actor).listGrievanceQueue()).rejects.toMatchObject({
      name: "DomainError",
      code: "enrolment_required",
    });
  });
});

describe("getGrievanceRequest", () => {
  it("shows the officer the request, its words and who filed it, and audits the view", async () => {
    const h = await createHarness();
    const officer = await signedInOfficer(h);
    const filed = await memberWithRequest(h, "correction", {
      name: "Asha Rao",
      email: "asha@example.test",
    });

    const result = await h
      .as(officer.actor)
      .getGrievanceRequest({ id: filed.requestId });

    expect(result).toMatchObject({
      ok: true,
      request: {
        reference: filed.reference,
        subjectKind: "user",
        subjectName: "Asha Rao",
        requester: { name: "Asha Rao", email: "asha@example.test" },
        correctionDetails: "Please spell my name correctly",
        notes: [],
        allowedEvents: ["start", "reject"],
        exportState: "none",
      },
    });
    const audit = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "privacy_request.viewed"));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("spell my name");
  });

  it("says a request isn't there, and refuses anyone but an officer", async () => {
    const h = await createHarness();
    const officer = await signedInOfficer(h);
    const filed = await memberWithRequest(h);

    expect(
      await h
        .as(officer.actor)
        .getGrievanceRequest({ id: "0190a000-0000-7000-8000-0000000000ff" })
    ).toEqual({ ok: false, error: "not_found" });
    for (const [who, actor] of await notOfficers(h)) {
      await expect(
        h.as(actor).getGrievanceRequest({ id: filed.requestId }),
        who
      ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
    }
  });
});
