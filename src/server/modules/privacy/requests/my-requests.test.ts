// #115a: a requester tracks and cancels their own requests; a verified
// guardian reads a teen's; nobody else learns anything about them.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { memberWithRequest, requestRows, signedInOfficer } from "./testing";

describe("getMyPrivacyRequest", () => {
  it("shows the requester their request, details and timeline", async () => {
    const h = await createHarness();
    const filed = await memberWithRequest(h, "correction");

    const view = await h.as(filed.actor).getMyPrivacyRequest({
      id: filed.requestId,
    });

    expect(view).toMatchObject({
      reference: filed.reference,
      type: "correction",
      status: "submitted",
      about: { kind: "self" },
      filedByYou: true,
      correctionDetails: "Please spell my name correctly",
      startedAt: null,
      closedAt: null,
      export: { state: "none" },
      canCancel: true,
    });
  });

  it("refuses another member, a visitor and an id that isn't anyone's", async () => {
    const h = await createHarness();
    const filed = await memberWithRequest(h);
    const other = await h.signIn(await h.seed.member());

    for (const [actor, id] of [
      [other, filed.requestId],
      [h.visitor(), filed.requestId],
      [filed.actor, "0190a000-0000-7000-8000-0000000000ff"],
    ] as const) {
      await expect(
        h.as(actor).getMyPrivacyRequest({ id })
      ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
    }
  });

  it("shows a teen's own request to their verified guardian, who can't cancel it", async () => {
    const h = await createHarness();
    const teenAccount = await h.seed.member({ name: "Tara Rao" });
    const family = await h.seed.guardian({
      children: [
        { fullName: "Tara Rao", age: 15, loginUserId: teenAccount.id },
      ],
    });
    const teen = await h.signIn(teenAccount);
    const filed = await h
      .as(teen)
      .submitPrivacyRequest({ type: "access", subject: { kind: "self" } });
    if (!filed.ok) throw new Error("expected a request");
    const guardian = await h.signIn(family.account);

    expect(
      await h.as(guardian).getMyPrivacyRequest({ id: filed.requestId })
    ).toMatchObject({
      about: { kind: "child", name: "Tara Rao" },
      filedByYou: false,
      canCancel: false,
    });
    await expect(
      h.as(guardian).cancelPrivacyRequest({ id: filed.requestId })
    ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
  });
});

describe("cancelPrivacyRequest", () => {
  it("withdraws a request nobody has started, with an audit row", async () => {
    const h = await createHarness();
    const filed = await memberWithRequest(h);

    expect(
      await h.as(filed.actor).cancelPrivacyRequest({ id: filed.requestId })
    ).toEqual({ ok: true });

    expect(await requestRows(h)).toEqual([
      expect.objectContaining({ status: "cancelled", closedAt: h.clock.now() }),
    ]);
    const audit = await h.db
      .select({ action: auditLog.action, after: auditLog.after })
      .from(auditLog)
      .where(eq(auditLog.entityId, filed.requestId));
    expect(audit.map((row) => row.action)).toEqual([
      "privacy_request.submitted",
      "privacy_request.cancelled",
    ]);
    // Cancelled is final: a second cancel changes nothing.
    expect(
      await h.as(filed.actor).cancelPrivacyRequest({ id: filed.requestId })
    ).toEqual({ ok: false, error: "request_closed" });
  });

  it("refuses once the grievance officer has started it", async () => {
    const h = await createHarness();
    const filed = await memberWithRequest(h);
    const officer = await signedInOfficer(h);
    await h.as(officer.actor).startPrivacyRequest({ id: filed.requestId });

    expect(
      await h.as(filed.actor).cancelPrivacyRequest({ id: filed.requestId })
    ).toEqual({ ok: false, error: "already_in_progress" });
    expect((await requestRows(h))[0]?.status).toBe("in_progress");
  });

  it("refuses another member, writing nothing", async () => {
    const h = await createHarness();
    const filed = await memberWithRequest(h);
    const other = await h.signIn(await h.seed.member());

    await expect(
      h.as(other).cancelPrivacyRequest({ id: filed.requestId })
    ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
    expect((await requestRows(h))[0]?.status).toBe("submitted");
  });
});
