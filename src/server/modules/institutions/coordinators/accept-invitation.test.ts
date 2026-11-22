import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { can } from "@/server/access";
import type { Actor } from "@/server/actor";
import {
  auditLog,
  institution,
  institutionInvitation,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { INVITATION_TTL_MS } from "@/server/modules/institutions/domain/invitation";
import { createHarness, type Harness } from "@/test/harness";
import {
  INVITATION_LINK,
  makeCoordinator,
  seedInstitution,
} from "@/test/institutions";

const TEACHER = "t@school.test";
const TEACHER_PHONE = "+919876543210";

/** The token in the newest invitation sent to `to`, by email or SMS. */
function tokenSentTo(h: Harness, to: string): string {
  const message = to.includes("@") ? h.email.lastTo(to) : h.sms.lastTo(to);
  const token = INVITATION_LINK.exec(message?.text ?? "")?.[1];
  if (!token) throw new Error(`No invitation link was sent to ${to}`);
  return token;
}

/** A verified institution whose authorised person has invited `to`. */
async function invited(h: Harness, to: string = TEACHER) {
  const seeded = await seedInstitution(h, { name: "Green Valley School" });
  const admin = await h.signIn(seeded.admin);
  const result = await h.as(admin).inviteCoordinator({
    institutionId: seeded.institution.id,
    identifier: to,
  });
  if (!result.ok) throw new Error(`Could not invite: ${result.error}`);
  await h.drain();
  return {
    ...seeded,
    adminActor: admin,
    invitationId: result.invitationId,
    token: tokenSentTo(h, to),
  };
}

function coordinates(h: Harness, actor: Actor, institutionId: string) {
  return can({ db: h.db, clock: h.clock, actor }, "institution.coordinate", {
    scopes: [{ type: "institution", id: institutionId }],
  });
}

describe("acceptInvitation", () => {
  it("makes the invitee a coordinator of that one institution", async () => {
    const h = await createHarness();
    const { institution: x, token, invitationId } = await invited(h);
    const { institution: y } = await seedInstitution(h);
    const teacher = await h.seed.member({ email: TEACHER });
    const actor = await h.signIn(teacher);

    const result = await h.as(actor).acceptInvitation({ token });

    expect(result).toEqual({ ok: true, institutionId: x.id });
    expect((await h.as(actor).myAccess()).grants).toEqual([
      {
        role: "institution_coordinator",
        scope: { type: "institution", id: x.id },
      },
    ]);
    expect(await coordinates(h, actor, x.id)).toEqual({
      allowed: true,
      role: "institution_coordinator",
    });
    expect(await coordinates(h, actor, y.id)).toEqual({ allowed: false });

    const [row] = await h.db
      .select()
      .from(institutionInvitation)
      .where(eq(institutionInvitation.id, invitationId));
    expect(row).toMatchObject({
      status: "accepted",
      acceptedByUserId: teacher.id,
      acceptedAt: h.clock.now(),
      tokenCiphertext: null,
    });
    const actions = await h.db
      .select({ action: auditLog.action, entityId: auditLog.entityId })
      .from(auditLog)
      .where(eq(auditLog.actorUserId, teacher.id));
    expect(actions).toEqual(
      expect.arrayContaining([
        { action: "institution.invitation_accepted", entityId: x.id },
        { action: "role.granted", entityId: teacher.id },
      ])
    );
  });

  it("works for someone who signs up with the invited address", async () => {
    const h = await createHarness();
    const { institution: x, token } = await invited(h);
    const visitor = h.visitor();
    await h.as(visitor).requestEmailCode({
      intent: "sign-up",
      name: "Meena Iyer",
      email: TEACHER,
    });
    await h.as(visitor).verifyEmailCode({
      intent: "sign-up",
      name: "Meena Iyer",
      email: TEACHER,
      code: h.email.codeFor(TEACHER)!,
    });
    const actor = await h.currentActor();

    expect(await h.as(actor).acceptInvitation({ token })).toEqual({
      ok: true,
      institutionId: x.id,
    });
  });

  it("matches a phone invitation by the account's verified phone", async () => {
    const h = await createHarness();
    await h.settings.set("sms.enabled", true);
    const { institution: x, token } = await invited(h, "098765 43210");
    const teacher = await h.seed.member({
      email: "meena@example.test",
      phone: TEACHER_PHONE,
    });

    const result = await h
      .as(await h.signIn(teacher))
      .acceptInvitation({ token });

    expect(result).toEqual({ ok: true, institutionId: x.id });
  });

  it("withdraws the person's other invitations waiting at that institution", async () => {
    const h = await createHarness();
    await h.settings.set("sms.enabled", true);
    const { institution: x, adminActor, token } = await invited(h);
    const byPhone = await h.as(adminActor).inviteCoordinator({
      institutionId: x.id,
      identifier: TEACHER_PHONE,
    });
    if (!byPhone.ok) throw new Error(`Could not invite: ${byPhone.error}`);
    const someoneElse = await h.as(adminActor).inviteCoordinator({
      institutionId: x.id,
      identifier: "ravi@school.test",
    });
    if (!someoneElse.ok) throw new Error("Could not invite");
    const teacher = await h.seed.member({
      email: TEACHER,
      phone: TEACHER_PHONE,
    });

    await h.as(await h.signIn(teacher)).acceptInvitation({ token });

    // Only the other person's invitation still waits.
    const list = await h
      .as(adminActor)
      .listCoordinators({ institutionId: x.id });
    expect(list.ok && list.invitations.map((each) => each.id)).toEqual([
      someoneElse.invitationId,
    ]);
    const [row] = await h.db
      .select()
      .from(institutionInvitation)
      .where(eq(institutionInvitation.id, byPhone.invitationId));
    expect(row).toMatchObject({
      status: "revoked",
      revokedByUserId: teacher.id,
      tokenCiphertext: null,
    });
    const entries = await h.db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(eq(auditLog.action, "institution.invitation_revoked"));
    expect(entries).toEqual([
      {
        after: {
          invitationId: byPhone.invitationId,
          status: "revoked",
          reason: "accepted_another",
        },
      },
    ]);
  });

  it("works until the last millisecond of the seventh day", async () => {
    const h = await createHarness();
    const { token } = await invited(h);
    const actor = await h.signIn(await h.seed.member({ email: TEACHER }));

    h.clock.advance({ milliseconds: INVITATION_TTL_MS - 1 });

    expect(await h.as(actor).acceptInvitation({ token })).toMatchObject({
      ok: true,
    });
  });

  it("refuses once seven days have passed", async () => {
    const h = await createHarness();
    const { token } = await invited(h);
    const actor = await h.signIn(await h.seed.member({ email: TEACHER }));

    h.clock.advance({ milliseconds: INVITATION_TTL_MS });

    expect(await h.as(actor).acceptInvitation({ token })).toEqual({
      ok: false,
      error: "expired",
    });
    expect((await h.as(actor).myAccess()).grants).toEqual([]);
  });

  it("can't be accepted twice, by the same person or anyone else", async () => {
    const h = await createHarness();
    const { token } = await invited(h);
    const teacher = await h.signIn(await h.seed.member({ email: TEACHER }));
    await h.as(teacher).acceptInvitation({ token });
    const other = await h.signIn(await h.seed.member());

    for (const actor of [teacher, other]) {
      expect(await h.as(actor).acceptInvitation({ token })).toEqual({
        ok: false,
        error: "already_accepted",
      });
    }
    expect((await h.as(other).myAccess()).grants).toEqual([]);
  });

  it("refuses a link replaced by a newer invitation; the newer one works", async () => {
    const h = await createHarness();
    const { institution: x, adminActor, token: oldToken } = await invited(h);
    await h
      .as(adminActor)
      .inviteCoordinator({ institutionId: x.id, identifier: TEACHER });
    await h.drain();
    const newToken = tokenSentTo(h, TEACHER);
    const actor = await h.signIn(await h.seed.member({ email: TEACHER }));

    expect(newToken).not.toBe(oldToken);
    expect(await h.as(actor).acceptInvitation({ token: oldToken })).toEqual({
      ok: false,
      error: "revoked",
    });
    expect(await h.as(actor).acceptInvitation({ token: newToken })).toEqual({
      ok: true,
      institutionId: x.id,
    });
  });

  it("refuses an account whose email or phone isn't the one invited", async () => {
    const h = await createHarness();
    const { token, invitationId } = await invited(h);
    const actor = await h.signIn(
      await h.seed.member({ email: "other@school.test" })
    );

    expect(await h.as(actor).acceptInvitation({ token })).toEqual({
      ok: false,
      error: "identifier_mismatch",
    });
    expect((await h.as(actor).myAccess()).grants).toEqual([]);
    const [row] = await h.db
      .select({ status: institutionInvitation.status })
      .from(institutionInvitation)
      .where(eq(institutionInvitation.id, invitationId));
    expect(row?.status).toBe("pending");
  });

  it("refuses while the institution is no longer verified", async () => {
    const h = await createHarness();
    const { institution: x, token } = await invited(h);
    await h.db
      .update(institution)
      .set({ status: "suspended" })
      .where(eq(institution.id, x.id));
    const actor = await h.signIn(await h.seed.member({ email: TEACHER }));

    expect(await h.as(actor).acceptInvitation({ token })).toEqual({
      ok: false,
      error: "institution_not_verified",
    });
  });

  it("keeps a coordinator's one role when they accept a second invitation", async () => {
    const h = await createHarness();
    const { institution: x, token } = await invited(h);
    const teacher = await h.seed.member({ email: TEACHER });
    await makeCoordinator(h, teacher, x.id);
    const actor = await h.signIn(teacher);

    expect(await h.as(actor).acceptInvitation({ token })).toEqual({
      ok: true,
      institutionId: x.id,
    });
    expect((await h.as(actor).myAccess()).grants).toHaveLength(1);
  });

  it("finds nothing for an unknown or malformed token", async () => {
    const h = await createHarness();
    await invited(h);
    const actor = await h.signIn(await h.seed.member({ email: TEACHER }));

    for (const token of ["", "short", "A".repeat(43), "?".repeat(43)]) {
      expect(await h.as(actor).acceptInvitation({ token }), token).toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });

  describe("authorization", () => {
    it("needs a signed-in account: a visitor is refused", async () => {
      const h = await createHarness();
      const { token, invitationId } = await invited(h);

      await expect(
        h.as(h.visitor()).acceptInvitation({ token })
      ).rejects.toThrow(DomainError);
      const [row] = await h.db
        .select({ status: institutionInvitation.status })
        .from(institutionInvitation)
        .where(
          and(
            eq(institutionInvitation.id, invitationId),
            eq(institutionInvitation.status, "pending")
          )
        );
      expect(row).toBeDefined();
    });
  });
});

describe("viewInvitation", () => {
  it("shows anyone holding the link the institution and a masked address", async () => {
    const h = await createHarness();
    const { token } = await invited(h);
    const expiresAt = new Date(h.clock.now().getTime() + INVITATION_TTL_MS);
    const invitation = {
      institutionName: "Green Valley School",
      status: "pending",
      channel: "email",
      maskedIdentifier: "t***@school.test",
      expiresAt,
    };

    expect(await h.as(h.visitor()).viewInvitation({ token })).toEqual({
      ok: true,
      invitation: { ...invitation, forYou: null },
    });
    const teacher = await h.signIn(await h.seed.member({ email: TEACHER }));
    expect(await h.as(teacher).viewInvitation({ token })).toEqual({
      ok: true,
      invitation: { ...invitation, forYou: true },
    });
    const other = await h.signIn(await h.seed.member());
    expect(await h.as(other).viewInvitation({ token })).toEqual({
      ok: true,
      invitation: { ...invitation, forYou: false },
    });
  });

  it("shows an invitation as accepted, then another as expired", async () => {
    const h = await createHarness();
    const { token } = await invited(h);
    const teacher = await h.signIn(await h.seed.member({ email: TEACHER }));
    await h.as(teacher).acceptInvitation({ token });
    const second = await invited(h, "second@school.test");

    expect(await h.as(h.visitor()).viewInvitation({ token })).toMatchObject({
      invitation: { status: "accepted" },
    });
    h.clock.advance({ days: 7 });
    expect(
      await h.as(h.visitor()).viewInvitation({ token: second.token })
    ).toMatchObject({ invitation: { status: "expired" } });
  });

  it("finds nothing for an unknown or malformed token", async () => {
    const h = await createHarness();
    await invited(h);

    for (const token of ["", "short", "A".repeat(43), "?".repeat(43)]) {
      expect(await h.as(h.visitor()).viewInvitation({ token }), token).toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });

  describe("authorization", () => {
    // The link is the credential for people; no background process reads
    // an invitation through it.
    it("refuses a system process, even with a good link", async () => {
      const h = await createHarness();
      const { token } = await invited(h);

      await expect(
        h.as({ kind: "system", process: "seed" }).viewInvitation({ token })
      ).rejects.toThrow(DomainError);
    });
  });
});
