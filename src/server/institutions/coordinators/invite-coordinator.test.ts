import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, institutionInvitation } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";
import { makeCoordinator, seedInstitution } from "@/test/institutions";

const TEACHER = "t@school.test";
const TEACHER_PHONE = "+91 98765 43210";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const LINK = /\/invitations\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;

async function invitationsOf(h: Harness, institutionId: string) {
  return h.db
    .select()
    .from(institutionInvitation)
    .where(eq(institutionInvitation.institutionId, institutionId));
}

describe("inviteCoordinator", () => {
  it("invites by email: a 7-day link reaches the address, with an audit row", async () => {
    const h = await createHarness();
    const { institution, admin } = await seedInstitution(h, {
      name: "Green Valley School",
    });
    const actor = await h.signIn(admin);

    const result = await h.as(actor).inviteCoordinator({
      institutionId: institution.id,
      identifier: TEACHER,
    });

    expect(result).toEqual({
      ok: true,
      invitationId: expect.any(String),
      expiresAt: new Date(h.clock.now().getTime() + SEVEN_DAYS_MS),
    });
    await h.drain();
    const sent = h.email.sent.filter((email) => email.to === TEACHER);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain("Green Valley School");
    expect(sent[0]!.text).toContain(admin.name);
    expect(sent[0]!.text).toMatch(LINK);
    expect(sent[0]!.text).toContain("http://localhost:3000/invitations/");

    const audit = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "institution.coordinator_invited"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorUserId: admin.id,
      actorRole: "institution_admin",
      entityType: "institution",
      entityId: institution.id,
      ip: expect.any(String),
    });
    // No personal data in the audit entry.
    expect(JSON.stringify(audit[0])).not.toContain(TEACHER);
  });

  it("stores neither the address nor the link's token readably", async () => {
    const h = await createHarness();
    const { institution, admin } = await seedInstitution(h);
    const actor = await h.signIn(admin);

    await h.as(actor).inviteCoordinator({
      institutionId: institution.id,
      identifier: TEACHER,
    });
    await h.drain();

    const token = LINK.exec(h.email.lastTo(TEACHER)!.text)![1]!;
    const rows = await h.db.$client.query(
      "select * from institution_invitation"
    );
    const raw = JSON.stringify(rows.rows);
    expect(raw).not.toContain(TEACHER);
    expect(raw).not.toContain(token);
    const outbox = await h.db.$client.query("select payload from outbox");
    expect(JSON.stringify(outbox.rows)).not.toContain(TEACHER);
    expect(JSON.stringify(outbox.rows)).not.toContain(token);
  });

  it("invites by phone with an SMS when SMS is on", async () => {
    const h = await createHarness();
    h.settings.set("sms.enabled", true);
    const { institution, admin } = await seedInstitution(h, {
      name: "Hill View School",
    });
    const actor = await h.signIn(admin);

    const result = await h.as(actor).inviteCoordinator({
      institutionId: institution.id,
      identifier: TEACHER_PHONE,
    });

    expect(result).toMatchObject({ ok: true });
    await h.drain();
    const sms = h.sms.lastTo("+919876543210");
    expect(sms?.text).toMatch(LINK);
    expect(sms?.text).toContain("Hill View School");
    expect(sms?.template).toBe("coordinator-invitation");
    const [row] = await invitationsOf(h, institution.id);
    expect(row?.channel).toBe("phone");
  });

  it("refuses a phone invitation while SMS is off, but email still works", async () => {
    const h = await createHarness();
    const { institution, admin } = await seedInstitution(h);
    const actor = await h.signIn(admin);

    const byPhone = await h.as(actor).inviteCoordinator({
      institutionId: institution.id,
      identifier: TEACHER_PHONE,
    });
    const byEmail = await h.as(actor).inviteCoordinator({
      institutionId: institution.id,
      identifier: TEACHER,
    });

    expect(byPhone).toEqual({ ok: false, error: "sms_disabled" });
    expect(byEmail).toMatchObject({ ok: true });
    expect(await invitationsOf(h, institution.id)).toHaveLength(1);
  });

  it.each(["pending_verification", "rejected", "suspended"] as const)(
    "refuses while the institution is %s: no row, no message",
    async (status) => {
      const h = await createHarness();
      const { institution, admin } = await seedInstitution(h, { status });
      const actor = await h.signIn(admin);
      const before = h.email.sent.length;

      const result = await h.as(actor).inviteCoordinator({
        institutionId: institution.id,
        identifier: TEACHER,
      });

      expect(result).toEqual({ ok: false, error: "institution_not_verified" });
      await h.drain();
      expect(h.email.sent.length).toBe(before);
      expect(await invitationsOf(h, institution.id)).toHaveLength(0);
    }
  );

  it("inviting the same person again withdraws the earlier invitation", async () => {
    const h = await createHarness();
    const { institution, admin } = await seedInstitution(h);
    const actor = await h.signIn(admin);

    const first = await h.as(actor).inviteCoordinator({
      institutionId: institution.id,
      identifier: TEACHER,
    });
    h.clock.advance({ minutes: 5 });
    const second = await h.as(actor).inviteCoordinator({
      institutionId: institution.id,
      identifier: " T@School.TEST ",
    });

    const rows = await invitationsOf(h, institution.id);
    const statusOf = new Map(rows.map((row) => [row.id, row.status]));
    expect(rows).toHaveLength(2);
    expect(statusOf.get(first.ok ? first.invitationId : "")).toBe("revoked");
    expect(statusOf.get(second.ok ? second.invitationId : "")).toBe("pending");
  });

  it("refuses an address that is not an email or an Indian mobile", async () => {
    const h = await createHarness();
    const { institution, admin } = await seedInstitution(h);
    const actor = await h.signIn(admin);

    for (const identifier of ["", "not an address", "12345", "a@b"]) {
      const result = await h
        .as(actor)
        .inviteCoordinator({ institutionId: institution.id, identifier });
      expect(result, identifier).toEqual({
        ok: false,
        error: "invalid_input",
        fields: ["identifier"],
      });
    }
    expect(await invitationsOf(h, institution.id)).toHaveLength(0);
  });

  it("refuses inviting someone who already coordinates there, or yourself", async () => {
    const h = await createHarness();
    const { institution, admin } = await seedInstitution(h);
    const teacher = await h.seed.member({ email: TEACHER });
    await makeCoordinator(h, teacher, institution.id);
    const actor = await h.signIn(admin);

    const existing = await h.as(actor).inviteCoordinator({
      institutionId: institution.id,
      identifier: TEACHER,
    });
    const self = await h.as(actor).inviteCoordinator({
      institutionId: institution.id,
      identifier: admin.email,
    });

    expect(existing).toEqual({ ok: false, error: "already_coordinator" });
    expect(self).toEqual({ ok: false, error: "cannot_invite_self" });
    expect(await invitationsOf(h, institution.id)).toHaveLength(0);
  });

  describe("authorization", () => {
    it("lets only the authorised person of that institution invite", async () => {
      const h = await createHarness();
      const { institution: x, admin } = await seedInstitution(h);
      const { admin: otherAdmin } = await seedInstitution(h);
      const coordinator = await h.seed.member();
      await makeCoordinator(h, coordinator, x.id);
      const member = await h.seed.member();
      const input = { institutionId: x.id, identifier: TEACHER };

      for (const refused of [coordinator, member, otherAdmin]) {
        const actor = await h.signIn(refused);
        await expect(
          h.as(actor).inviteCoordinator(input),
          refused.name
        ).rejects.toThrow(DomainError);
      }
      await expect(h.as(h.visitor()).inviteCoordinator(input)).rejects.toThrow(
        DomainError
      );
      expect(await invitationsOf(h, x.id)).toHaveLength(0);

      const allowed = await h
        .as(await h.signIn(admin))
        .inviteCoordinator(input);
      expect(allowed).toMatchObject({ ok: true });
    });
  });
});
