import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { can } from "@/server/access";
import type { Actor } from "@/server/actor";
import { auditLog, userRole } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { signedInStaff } from "@/server/modules/institutions/testing";
import { createHarness, type Harness } from "@/test/harness";
import { makeCoordinator, seedInstitution } from "@/test/institutions";

const LINK = /\/invitations\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function invite(
  h: Harness,
  admin: Actor,
  institutionId: string,
  to: string
) {
  const result = await h
    .as(admin)
    .inviteCoordinator({ institutionId, identifier: to });
  if (!result.ok) throw new Error(`Could not invite: ${result.error}`);
  await h.drain();
  const message = to.includes("@") ? h.email.lastTo(to) : h.sms.lastTo(to);
  const token = LINK.exec(message?.text ?? "")?.[1];
  if (!token) throw new Error(`No link reached ${to}`);
  return { invitationId: result.invitationId, token };
}

function coordinates(h: Harness, actor: Actor, institutionId: string) {
  return can({ db: h.db, clock: h.clock, actor }, "institution.coordinate", {
    scopes: [{ type: "institution", id: institutionId }],
  });
}

describe("listCoordinators", () => {
  it("lists the coordinators and the invitations still waiting", async () => {
    const h = await createHarness();
    const { institution: x, admin } = await seedInstitution(h, {
      name: "Green Valley School",
    });
    const meena = await h.seed.member({
      name: "Meena Iyer",
      email: "meena@school.test",
    });
    await makeCoordinator(h, meena, x.id);
    const since = h.clock.now();
    const actor = await h.signIn(admin);
    h.clock.advance({ hours: 1 });
    const waiting = await invite(h, actor, x.id, "ravi@school.test");
    const sentAt = h.clock.now();
    // Accepted and withdrawn invitations aren't listed.
    const accepted = await invite(h, actor, x.id, "anu@school.test");
    const anu = await h.seed.member({
      name: "Anu Das",
      email: "anu@school.test",
    });
    const anuActor = await h.signIn(anu);
    await h.as(anuActor).acceptInvitation({ token: accepted.token });
    const withdrawn = await invite(h, actor, x.id, "gone@school.test");
    await h.as(actor).revokeInvitation({
      institutionId: x.id,
      invitationId: withdrawn.invitationId,
    });

    const result = await h.as(actor).listCoordinators({ institutionId: x.id });

    expect(result).toEqual({
      ok: true,
      institution: { id: x.id, name: "Green Valley School" },
      coordinators: [
        { userId: anu.id, name: "Anu Das", since: h.clock.now() },
        { userId: meena.id, name: "Meena Iyer", since },
      ],
      invitations: [
        {
          id: waiting.invitationId,
          channel: "email",
          maskedIdentifier: "r***@school.test",
          status: "pending",
          sentAt,
          expiresAt: new Date(sentAt.getTime() + SEVEN_DAYS_MS),
        },
      ],
    });
  });

  it("shows an invitation nobody accepted in seven days as expired", async () => {
    const h = await createHarness();
    const { institution: x, admin } = await seedInstitution(h);
    const actor = await h.signIn(admin);
    await invite(h, actor, x.id, "ravi@school.test");

    h.clock.advance({ days: 7 });
    const result = await h.as(actor).listCoordinators({ institutionId: x.id });

    expect(result.ok && result.invitations.map((each) => each.status)).toEqual([
      "expired",
    ]);
  });
});

describe("removeCoordinator", () => {
  it("revokes the role at once and records who removed whom", async () => {
    const h = await createHarness();
    const { institution: x, admin } = await seedInstitution(h);
    const meena = await h.seed.member({ email: "meena@school.test" });
    await makeCoordinator(h, meena, x.id);
    const meenaActor = await h.signIn(meena);
    expect(await coordinates(h, meenaActor, x.id)).toMatchObject({
      allowed: true,
    });
    const actor = await h.signIn(admin, { userAgent: "Principal's browser" });

    const result = await h
      .as(actor)
      .removeCoordinator({ institutionId: x.id, userId: meena.id });

    expect(result).toEqual({ ok: true });
    // Her session is still open; her next check is refused.
    expect(await coordinates(h, meenaActor, x.id)).toEqual({ allowed: false });
    expect(
      await h.db
        .select()
        .from(userRole)
        .where(and(eq(userRole.userId, meena.id), eq(userRole.scopeId, x.id)))
    ).toEqual([]);
    const [entry] = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "institution.coordinator_removed"));
    expect(entry).toMatchObject({
      actorUserId: admin.id,
      actorRole: "institution_admin",
      entityType: "institution",
      entityId: x.id,
      ip: expect.any(String),
      userAgent: "Principal's browser",
      before: { userId: meena.id, role: "institution_coordinator" },
      after: null,
    });
    const revoked = await h.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "role.revoked"),
          eq(auditLog.entityId, meena.id)
        )
      );
    expect(revoked).toHaveLength(1);
  });

  // Review r1 (skeptic): invited by email and by phone, accepted one,
  // removed, then accepted the other link still waiting.
  it("stays removed: another invitation to the same person no longer works", async () => {
    const h = await createHarness();
    await h.settings.set("sms.enabled", true);
    const { institution: x, admin } = await seedInstitution(h);
    const actor = await h.signIn(admin);
    const byEmail = await invite(h, actor, x.id, "t@school.test");
    const byPhone = await invite(h, actor, x.id, "+919876543210");
    const teacher = await h.seed.member({
      email: "t@school.test",
      phone: "+919876543210",
    });
    const teacherActor = await h.signIn(teacher);
    expect(
      await h.as(teacherActor).acceptInvitation({ token: byEmail.token })
    ).toMatchObject({ ok: true });
    expect(
      await h
        .as(actor)
        .removeCoordinator({ institutionId: x.id, userId: teacher.id })
    ).toEqual({ ok: true });

    expect(
      await h.as(teacherActor).acceptInvitation({ token: byPhone.token })
    ).toEqual({ ok: false, error: "revoked" });
    expect(await coordinates(h, teacherActor, x.id)).toEqual({
      allowed: false,
    });
  });

  it("withdraws the invitations still waiting for the removed person", async () => {
    const h = await createHarness();
    await h.settings.set("sms.enabled", true);
    const { institution: x, admin } = await seedInstitution(h);
    const actor = await h.signIn(admin);
    // Invited by phone before they became a coordinator another way.
    const byPhone = await invite(h, actor, x.id, "+919876543210");
    const other = await invite(h, actor, x.id, "ravi@school.test");
    const teacher = await h.seed.member({
      email: "t@school.test",
      phone: "+919876543210",
    });
    await makeCoordinator(h, teacher, x.id);

    await h
      .as(actor)
      .removeCoordinator({ institutionId: x.id, userId: teacher.id });

    expect(
      await h
        .as(await h.signIn(teacher))
        .acceptInvitation({ token: byPhone.token })
    ).toEqual({ ok: false, error: "revoked" });
    const list = await h.as(actor).listCoordinators({ institutionId: x.id });
    expect(list.ok && list.invitations.map((each) => each.id)).toEqual([
      other.invitationId,
    ]);
    const entries = await h.db
      .select({ after: auditLog.after, actorUserId: auditLog.actorUserId })
      .from(auditLog)
      .where(eq(auditLog.action, "institution.invitation_revoked"));
    expect(entries).toEqual([
      {
        after: {
          invitationId: byPhone.invitationId,
          status: "revoked",
          reason: "coordinator_removed",
        },
        actorUserId: admin.id,
      },
    ]);
  });

  it("finds no coordinator to remove for someone who isn't one there", async () => {
    const h = await createHarness();
    const { institution: x, admin } = await seedInstitution(h);
    const { institution: y } = await seedInstitution(h);
    const elsewhere = await h.seed.member();
    await makeCoordinator(h, elsewhere, y.id);
    const actor = await h.signIn(admin);

    for (const userId of [elsewhere.id, admin.id]) {
      expect(
        await h.as(actor).removeCoordinator({ institutionId: x.id, userId })
      ).toEqual({ ok: false, error: "not_found" });
    }
    expect(await coordinates(h, await h.signIn(elsewhere), y.id)).toMatchObject(
      {
        allowed: true,
      }
    );
  });
});

describe("revokeInvitation", () => {
  it("withdraws a waiting invitation, so its link stops working", async () => {
    const h = await createHarness();
    const { institution: x, admin } = await seedInstitution(h);
    const actor = await h.signIn(admin);
    const { invitationId, token } = await invite(
      h,
      actor,
      x.id,
      "ravi@school.test"
    );

    const result = await h
      .as(actor)
      .revokeInvitation({ institutionId: x.id, invitationId });

    expect(result).toEqual({ ok: true });
    const ravi = await h.signIn(
      await h.seed.member({ email: "ravi@school.test" })
    );
    expect(await h.as(ravi).acceptInvitation({ token })).toEqual({
      ok: false,
      error: "revoked",
    });
    const entries = await h.db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(eq(auditLog.action, "institution.invitation_revoked"));
    expect(entries).toEqual([
      { after: { invitationId, status: "revoked", reason: "withdrawn" } },
    ]);
  });

  it("refuses an accepted or already withdrawn invitation, and finds none elsewhere", async () => {
    const h = await createHarness();
    const { institution: x, admin } = await seedInstitution(h);
    const { institution: y, admin: otherAdmin } = await seedInstitution(h);
    const actor = await h.signIn(admin);
    const accepted = await invite(h, actor, x.id, "anu@school.test");
    await h
      .as(await h.signIn(await h.seed.member({ email: "anu@school.test" })))
      .acceptInvitation({ token: accepted.token });
    const withdrawn = await invite(h, actor, x.id, "gone@school.test");
    await h.as(actor).revokeInvitation({
      institutionId: x.id,
      invitationId: withdrawn.invitationId,
    });
    const theirs = await invite(
      h,
      await h.signIn(otherAdmin),
      y.id,
      "t@school.test"
    );

    expect(
      await h.as(actor).revokeInvitation({
        institutionId: x.id,
        invitationId: accepted.invitationId,
      })
    ).toEqual({ ok: false, error: "already_accepted" });
    expect(
      await h.as(actor).revokeInvitation({
        institutionId: x.id,
        invitationId: withdrawn.invitationId,
      })
    ).toEqual({ ok: false, error: "revoked" });
    // Another institution's invitation, named under this one: not found.
    expect(
      await h.as(actor).revokeInvitation({
        institutionId: x.id,
        invitationId: theirs.invitationId,
      })
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("authorization and isolation", () => {
  it("keeps a coordinator of one institution out of another, and out of managing either", async () => {
    const h = await createHarness();
    const { institution: a } = await seedInstitution(h);
    const { institution: b, admin: adminB } = await seedInstitution(h);
    const coordinatorA = await h.seed.member();
    await makeCoordinator(h, coordinatorA, a.id);
    const colleagueB = await h.seed.member();
    await makeCoordinator(h, colleagueB, b.id);
    const adminActorB = await h.signIn(adminB);
    const { invitationId } = await invite(
      h,
      adminActorB,
      b.id,
      "ravi@school.test"
    );
    const actor = await h.signIn(coordinatorA);

    expect(await coordinates(h, actor, a.id)).toMatchObject({ allowed: true });
    expect(await coordinates(h, actor, b.id)).toEqual({ allowed: false });
    for (const institutionId of [a.id, b.id]) {
      const calls = [
        () => h.as(actor).listCoordinators({ institutionId }),
        () =>
          h
            .as(actor)
            .inviteCoordinator({ institutionId, identifier: "x@school.test" }),
        () =>
          h
            .as(actor)
            .removeCoordinator({ institutionId, userId: colleagueB.id }),
        () => h.as(actor).revokeInvitation({ institutionId, invitationId }),
      ];
      for (const call of calls)
        await expect(call()).rejects.toThrow(DomainError);
    }
    expect(
      await coordinates(h, await h.signIn(colleagueB), b.id)
    ).toMatchObject({
      allowed: true,
    });
  });

  it("lets only the authorised person of that institution list, remove and withdraw", async () => {
    const h = await createHarness();
    const { institution: x, admin } = await seedInstitution(h);
    const { admin: otherAdmin } = await seedInstitution(h);
    const coordinator = await h.seed.member();
    await makeCoordinator(h, coordinator, x.id);
    const member = await h.seed.member();
    const adminActor = await h.signIn(admin);
    const { invitationId } = await invite(
      h,
      adminActor,
      x.id,
      "ravi@school.test"
    );
    const refusedActors: Actor[] = [
      h.visitor(),
      await h.signIn(member),
      await h.signIn(otherAdmin),
    ];

    for (const actor of refusedActors) {
      await expect(
        h.as(actor).listCoordinators({ institutionId: x.id })
      ).rejects.toThrow(DomainError);
      await expect(
        h
          .as(actor)
          .removeCoordinator({ institutionId: x.id, userId: coordinator.id })
      ).rejects.toThrow(DomainError);
      await expect(
        h.as(actor).revokeInvitation({ institutionId: x.id, invitationId })
      ).rejects.toThrow(DomainError);
    }

    expect(
      await h.as(adminActor).listCoordinators({ institutionId: x.id })
    ).toMatchObject({
      ok: true,
    });
    expect(
      await h
        .as(adminActor)
        .revokeInvitation({ institutionId: x.id, invitationId })
    ).toEqual({ ok: true });
    expect(
      await h
        .as(adminActor)
        .removeCoordinator({ institutionId: x.id, userId: coordinator.id })
    ).toEqual({ ok: true });
  });
});

describe("an institution that isn't verified", () => {
  it("lets its authorised person list, remove and withdraw only while it is verified", async () => {
    // #73 keeps the authorised person's institution_admin grant through a
    // suspension, so the status, not the role, must stop them.
    const h = await createHarness();
    const { institution: x, admin } = await seedInstitution(h);
    const coordinator = await h.seed.member();
    await makeCoordinator(h, coordinator, x.id);
    const adminActor = await h.signIn(admin);
    const { invitationId } = await invite(
      h,
      adminActor,
      x.id,
      "ravi@school.test"
    );
    const staff = h.as(await signedInStaff(h));
    const decide = async (decision: "suspend" | "verify") => {
      const result = await staff.decideInstitution({
        institutionId: x.id,
        decision,
        reason: "Checked the school's records",
      });
      if (!result.ok) throw new Error(`Could not ${decision}: ${result.error}`);
    };
    const refused = { ok: false, error: "institution_not_verified" };

    await decide("suspend");

    expect(
      await h.as(adminActor).listCoordinators({ institutionId: x.id })
    ).toEqual(refused);
    expect(
      await h
        .as(adminActor)
        .removeCoordinator({ institutionId: x.id, userId: coordinator.id })
    ).toEqual(refused);
    expect(
      await h
        .as(adminActor)
        .revokeInvitation({ institutionId: x.id, invitationId })
    ).toEqual(refused);
    expect(
      await coordinates(h, await h.signIn(coordinator), x.id)
    ).toMatchObject({ allowed: true });
    expect(
      await h.db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.action, "institution.coordinator_removed"))
    ).toEqual([]);

    await decide("verify");

    expect(
      await h.as(adminActor).listCoordinators({ institutionId: x.id })
    ).toMatchObject({
      ok: true,
      coordinators: [{ userId: coordinator.id }],
      invitations: [{ id: invitationId, status: "pending" }],
    });
    expect(
      await h
        .as(adminActor)
        .revokeInvitation({ institutionId: x.id, invitationId })
    ).toEqual({ ok: true });
    expect(
      await h
        .as(adminActor)
        .removeCoordinator({ institutionId: x.id, userId: coordinator.id })
    ).toEqual({ ok: true });
  });
});
