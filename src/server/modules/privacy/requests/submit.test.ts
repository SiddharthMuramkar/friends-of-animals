// #115a: a signed-in user files an access, correction or erasure request
// about their own data; a verified guardian files one for a linked child.
// Each lands `submitted`, due after the type's period, with an audit row
// that holds no personal data.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, privacyRequest } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { requestRows } from "./testing";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("submitPrivacyRequest: for oneself", () => {
  it("files each type, due 30 days later, and lists them with their status", async () => {
    const h = await createHarness();
    const member = await h.seed.member({ name: "Asha Rao" });
    const asha = await h.signIn(member);
    const filedAt = h.clock.now();

    const access = await h.as(asha).submitPrivacyRequest({
      type: "access",
      subject: { kind: "self" },
    });
    const correction = await h.as(asha).submitPrivacyRequest({
      type: "correction",
      subject: { kind: "self" },
      correctionDetails: "My surname is Rao, not Roa",
    });
    const erasure = await h.as(asha).submitPrivacyRequest({
      type: "erasure",
      subject: { kind: "self" },
    });

    for (const result of [access, correction, erasure]) {
      expect(result).toMatchObject({
        ok: true,
        reference: expect.stringMatching(/^PR-27-[0-9A-HJKMNP-TV-Z]{6}$/),
      });
    }
    const rows = await requestRows(h);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        status: "submitted",
        relation: "self",
        subjectKind: "user",
        subjectId: member.id,
        requestedByUserId: member.id,
        dueAt: new Date(filedAt.getTime() + 30 * DAY_MS),
      });
    }

    const mine = await h.as(asha).listMyPrivacyRequests();
    expect(mine.map((request) => request.type).sort()).toEqual([
      "access",
      "correction",
      "erasure",
    ]);
    expect(mine.every((request) => request.status === "submitted")).toBe(true);
    expect(mine.every((request) => request.filedByYou)).toBe(true);
  });

  it("dates an erasure by the erasure period, which is its own setting", async () => {
    const h = await createHarness();
    await h.settings.set("privacy.erasureDueDays", 15);
    await h.settings.set("privacy.requestDueDays", 45);
    const member = await h.seed.member();
    const actor = await h.signIn(member);
    const filedAt = h.clock.now();

    await h
      .as(actor)
      .submitPrivacyRequest({ type: "erasure", subject: { kind: "self" } });
    await h
      .as(actor)
      .submitPrivacyRequest({ type: "access", subject: { kind: "self" } });

    const dueAt = Object.fromEntries(
      (await requestRows(h)).map((row) => [row.type, row.dueAt.getTime()])
    );
    expect(dueAt).toEqual({
      erasure: filedAt.getTime() + 15 * DAY_MS,
      access: filedAt.getTime() + 45 * DAY_MS,
    });
  });

  it("needs details for a correction, and writes nothing without them", async () => {
    const h = await createHarness();
    const actor = await h.signIn(await h.seed.member());

    const result = await h.as(actor).submitPrivacyRequest({
      type: "correction",
      subject: { kind: "self" },
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["correctionDetails"],
    });
    expect(await requestRows(h)).toEqual([]);
  });

  it("keeps the correction details encrypted and out of the audit log", async () => {
    const h = await createHarness();
    const actor = await h.signIn(await h.seed.member());

    const result = await h.as(actor).submitPrivacyRequest({
      type: "correction",
      subject: { kind: "self" },
      correctionDetails: "Spell my name Kulkarni",
    });
    if (!result.ok) throw new Error("expected a request");

    const [row] = await h.db
      .select({ stored: privacyRequest.correctionDetails })
      .from(privacyRequest);
    expect(row?.stored).not.toContain("Kulkarni");
    const audit = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, result.requestId));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "privacy_request.submitted",
      entityType: "privacy_request",
      before: null,
      after: {
        type: "correction",
        status: "submitted",
        relation: "self",
        subjectKind: "user",
        assignedToUserId: null,
      },
    });
    expect(JSON.stringify(audit)).not.toContain("Kulkarni");
  });

  it("refuses a second open request of the same type about the same person", async () => {
    const h = await createHarness();
    const actor = await h.signIn(await h.seed.member());
    const first = await h
      .as(actor)
      .submitPrivacyRequest({ type: "access", subject: { kind: "self" } });
    if (!first.ok) throw new Error("expected a request");

    const again = await h
      .as(actor)
      .submitPrivacyRequest({ type: "access", subject: { kind: "self" } });

    expect(again).toEqual({
      ok: false,
      error: "already_open",
      reference: first.reference,
    });
    expect(await requestRows(h)).toHaveLength(1);
  });
});

describe("submitPrivacyRequest: a guardian for a child", () => {
  it("files for a linked child, who is the subject", async () => {
    const h = await createHarness();
    const family = await h.seed.guardian({
      children: [{ fullName: "Ira Rao", age: 9 }],
    });
    const guardian = await h.signIn(family.account);

    const result = await h.as(guardian).submitPrivacyRequest({
      type: "erasure",
      subject: { kind: "child", childId: family.childIds[0]! },
    });

    expect(result).toMatchObject({ ok: true });
    expect(await requestRows(h)).toEqual([
      expect.objectContaining({
        relation: "guardian",
        subjectKind: "participant_profile",
        subjectId: family.childIds[0],
        requestedByUserId: family.account.id,
      }),
    ]);
    const [listed] = await h.as(guardian).listMyPrivacyRequests();
    expect(listed).toMatchObject({
      about: { kind: "child", name: "Ira Rao" },
      filedByYou: true,
    });
  });

  it("refuses a child the guardian isn't linked to, writing nothing", async () => {
    const h = await createHarness();
    const theirs = await h.seed.guardian({
      children: [{ fullName: "Ira Rao", age: 9 }],
    });
    const other = await h.seed.guardian({
      children: [{ fullName: "Dev Shah", age: 10 }],
    });
    const actor = await h.signIn(other.account);

    await expect(
      h.as(actor).submitPrivacyRequest({
        type: "access",
        subject: { kind: "child", childId: theirs.childIds[0]! },
      })
    ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
    expect(await requestRows(h)).toEqual([]);
  });

  it("refuses a guardian who hasn't verified, and a child who is now 18", async () => {
    const h = await createHarness();
    const family = await h.seed.guardian({
      children: [
        { fullName: "Ira Rao", age: 9 },
        { fullName: "Kiran Rao", age: 18 },
      ],
    });
    const actor = await h.signIn(family.account);

    expect(
      await h.as(actor).submitPrivacyRequest({
        type: "access",
        subject: { kind: "child", childId: family.childIds[1]! },
      })
    ).toEqual({ ok: false, error: "child_is_adult" });

    // A guardian record that loses its verification can't file.
    const { guardian } = await import("@/server/db/schema");
    await h.db
      .update(guardian)
      .set({ verifiedAt: null, verificationMethod: null })
      .where(eq(guardian.id, family.guardianId));
    expect(
      await h.as(actor).submitPrivacyRequest({
        type: "access",
        subject: { kind: "child", childId: family.childIds[0]! },
      })
    ).toEqual({ ok: false, error: "guardian_not_verified" });
    expect(await requestRows(h)).toEqual([]);
  });
});

describe("submitPrivacyRequest: a teen with their own login", () => {
  it("files access and correction, not erasure, and their guardian sees them", async () => {
    const h = await createHarness();
    const teenAccount = await h.seed.member({ name: "Tara Rao" });
    const family = await h.seed.guardian({
      children: [
        { fullName: "Tara Rao", age: 15, loginUserId: teenAccount.id },
      ],
    });
    const teen = await h.signIn(teenAccount);

    expect(
      await h
        .as(teen)
        .submitPrivacyRequest({ type: "access", subject: { kind: "self" } })
    ).toMatchObject({ ok: true });
    expect(
      await h.as(teen).submitPrivacyRequest({
        type: "correction",
        subject: { kind: "self" },
        correctionDetails: "My school is wrong",
      })
    ).toMatchObject({ ok: true });
    expect(
      await h
        .as(teen)
        .submitPrivacyRequest({ type: "erasure", subject: { kind: "self" } })
    ).toEqual({ ok: false, error: "erasure_needs_guardian" });

    const guardian = await h.signIn(family.account);
    const seen = await h.as(guardian).listMyPrivacyRequests();
    expect(seen).toHaveLength(2);
    for (const request of seen) {
      expect(request).toMatchObject({
        about: { kind: "child", name: "Tara Rao" },
        filedByYou: false,
      });
    }
  });
});

describe("submitPrivacyRequest: who may file", () => {
  it("refuses a visitor and the platform's own processes", async () => {
    const h = await createHarness();
    for (const actor of [
      h.visitor(),
      { kind: "system", process: "worker" } as const,
    ]) {
      await expect(
        h
          .as(actor)
          .submitPrivacyRequest({ type: "access", subject: { kind: "self" } })
      ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
    }
    expect(await requestRows(h)).toEqual([]);
  });
});
