import { asc, count, eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditLog,
  secondFactor,
  secondFactorLockout,
  sessionSecondFactor,
  userRole,
  webauthnChallenge,
} from "@/server/db/schema";
import { sqlState } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";

import type { Actor } from "../../actor";
import { base32Decode } from "./domain/base32";
import { totpCode } from "./domain/totp";

const judge = { role: "judge", scope: { type: "global" } } as const;

async function counts(h: Harness) {
  const [grants] = await h.db.select({ n: count() }).from(userRole);
  const [roleEntries] = await h.db
    .select({ n: count() })
    .from(auditLog)
    .where(like(auditLog.action, "role.%"));
  return { grants: grants?.n, roleEntries: roleEntries?.n };
}

function secondFactorAudit(h: Harness) {
  return h.db
    .select({
      action: auditLog.action,
      actorUserId: auditLog.actorUserId,
      actorRole: auditLog.actorRole,
      entityId: auditLog.entityId,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .where(like(auditLog.action, "second_factor.%"))
    .orderBy(asc(auditLog.id));
}

/** A super admin who passed their second factor just now. */
async function freshSuperAdmin(h: Harness) {
  const admin = await h.seed.superAdmin();
  return { admin, actor: await h.signIn(admin) };
}

describe("step-up on granting and revoking roles", () => {
  it("grants with a second factor 9 min 59 s old, and refuses step_up_required at 10 min 1 s without changing anything", async () => {
    const h = await createHarness();
    const { actor } = await freshSuperAdmin(h);
    const [first, second] = [await h.seed.member(), await h.seed.member()];

    h.clock.advance({ minutes: 9, seconds: 59 });
    expect(
      await h.as(actor).grantRole({ userId: first.id, ...judge })
    ).toMatchObject({ ok: true, changed: true });

    h.clock.advance({ seconds: 2 });
    const before = await counts(h);
    await expect(
      h.as(actor).grantRole({ userId: second.id, ...judge })
    ).rejects.toMatchObject({ code: "step_up_required" });
    expect(await counts(h)).toEqual(before);
  });

  it("revokes only with a fresh second factor", async () => {
    const h = await createHarness();
    const { actor } = await freshSuperAdmin(h);
    const member = await h.seed.member();
    await h.seed.grant(member, judge);

    h.clock.advance({ minutes: 10, seconds: 1 });
    const before = await counts(h);
    await expect(
      h.as(actor).revokeRole({ userId: member.id, ...judge })
    ).rejects.toMatchObject({ code: "step_up_required" });
    expect(await counts(h)).toEqual(before);

    // The step-up screen asks for the factor again.
    expect(
      await h.as(actor).verifySecondFactor({ code: h.totpCode() })
    ).toEqual({ ok: true });
    expect(
      await h.as(actor).revokeRole({ userId: member.id, ...judge })
    ).toMatchObject({ ok: true, changed: true });
  });

  it("asks a super admin who hasn't enrolled to enrol before granting", async () => {
    const h = await createHarness();
    const admin = await h.seed.superAdmin();
    const actor = await h.signIn(admin, undefined, { secondFactor: false });
    const member = await h.seed.member();

    await expect(
      h.as(actor).grantRole({ userId: member.id, ...judge })
    ).rejects.toMatchObject({ code: "enrolment_required" });
  });

  it("still refuses a staff admin with forbidden, however fresh their second factor", async () => {
    const h = await createHarness();
    const staffAdmin = await h.seed.member();
    await h.seed.grant(staffAdmin, {
      role: "staff_admin",
      scope: { type: "global" },
    });
    const actor = await h.signIn(staffAdmin);
    const member = await h.seed.member();

    await expect(
      h.as(actor).grantRole({ userId: member.id, ...judge })
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("leaves staff actions that aren't sensitive open after the window", async () => {
    const h = await createHarness();
    const { actor } = await freshSuperAdmin(h);
    h.clock.advance({ hours: 1 });

    expect(await h.as(actor).searchUsers({ query: "test" })).toMatchObject({
      ok: true,
    });
  });
});

describe("removeSecondFactor", () => {
  async function enrolledMember(h: Harness) {
    const member = await h.seed.member();
    const actor = await h.signIn(member);
    await h.passSecondFactor(actor);
    const [factor] = await h.db
      .select({ id: secondFactor.id, label: secondFactor.label })
      .from(secondFactor)
      .where(eq(secondFactor.userId, member.id));
    if (!factor) throw new Error("No factor");
    return { member, actor, factor };
  }

  it("removes a factor with a fresh second factor and audits it, without its secret", async () => {
    const h = await createHarness();
    const { member, actor, factor } = await enrolledMember(h);

    expect(
      await h.as(actor).removeSecondFactor({ factorId: factor.id })
    ).toEqual({ ok: true });

    expect(await h.as(actor).mySecondFactors()).toMatchObject({ factors: [] });
    const entries = await secondFactorAudit(h);
    expect(entries.at(-1)).toEqual({
      action: "second_factor.removed",
      actorUserId: member.id,
      actorRole: null,
      entityId: member.id,
      before: { factorId: factor.id, kind: "totp", label: factor.label },
      after: null,
    });
    expect(JSON.stringify(entries)).not.toMatch(/v1\./);
  });

  it("keeps only the stepped-up session when the last factor is removed", async () => {
    const h = await createHarness();
    const { member, actor, factor } = await enrolledMember(h);
    const actingBrowser = h.cookies.header();
    const otherDevice = await h.signIn(member);
    const verifiedBrowser = h.cookies.header();
    h.clock.advance({ seconds: 30 });
    await h.passSecondFactor(otherDevice);
    await h.signIn(member);
    const primaryBrowser = h.cookies.header();
    await h.as(actor).startPasskeyRegistration();
    await h.as(actor).startTotpEnrolment({ label: "Pending authenticator" });

    expect(
      await h.as(actor).removeSecondFactor({ factorId: factor.id })
    ).toEqual({
      ok: true,
    });

    expect(await h.db.select().from(sessionSecondFactor)).toEqual([]);
    expect((await h.currentActor(undefined, verifiedBrowser)).kind).toBe(
      "visitor"
    );
    expect((await h.currentActor(undefined, primaryBrowser)).kind).toBe(
      "visitor"
    );
    expect(
      await h.db
        .select({ purpose: webauthnChallenge.purpose })
        .from(webauthnChallenge)
    ).toEqual([]);
    expect(
      await h.db.select({ id: secondFactor.id }).from(secondFactor)
    ).toEqual([]);

    const current = await h.currentActor(undefined, actingBrowser);
    expect(current).toMatchObject({
      kind: "user",
      sessionId: sessionOf(actor),
    });
    const replacement = await h
      .as(current)
      .startTotpEnrolment({ label: "Replacement" });
    expect(replacement.ok).toBe(true);
  });

  it("makes the user's other sessions pass a second factor again, in case one passed with it", async () => {
    const h = await createHarness();
    const { member, actor } = await enrolledMember(h);
    const started = await h.as(actor).startTotpEnrolment({ label: "Old" });
    if (!started.ok) throw new Error("Could not start");
    const oldPhone = base32Decode(started.secret);
    await h.as(actor).confirmTotpEnrolment({
      factorId: started.factorId,
      code: totpCode(oldPhone, h.clock.now()),
    });
    const otherDevice = await h.signIn(member);
    h.clock.advance({ seconds: 30 });
    expect(
      await h
        .as(otherDevice)
        .verifySecondFactor({ code: totpCode(oldPhone, h.clock.now()) })
    ).toEqual({ ok: true });

    // The old phone is lost, so the user removes it.
    expect(
      await h.as(actor).removeSecondFactor({ factorId: started.factorId })
    ).toEqual({ ok: true });

    expect(await h.as(otherDevice).mySecondFactors()).toMatchObject({
      verifiedAt: null,
    });
    expect((await h.as(actor).mySecondFactors()).verifiedAt).not.toBeNull();
  });

  it("needs step-up", async () => {
    const h = await createHarness();
    const { actor, factor } = await enrolledMember(h);
    h.clock.advance({ minutes: 10, seconds: 1 });

    await expect(
      h.as(actor).removeSecondFactor({ factorId: factor.id })
    ).rejects.toMatchObject({ code: "step_up_required" });
    expect(await h.db.select().from(secondFactor)).toHaveLength(1);
  });

  it("can't remove another user's factor", async () => {
    const h = await createHarness();
    const { factor } = await enrolledMember(h);
    const { actor: other } = await enrolledMember(h);

    expect(
      await h.as(other).removeSecondFactor({ factorId: factor.id })
    ).toEqual({ ok: false, error: "not_found" });
    expect(await h.db.select().from(secondFactor)).toHaveLength(2);
  });

  it("refuses a visitor", async () => {
    const h = await createHarness();
    await expect(
      h.as(h.visitor()).removeSecondFactor({ factorId: crypto.randomUUID() })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("adding another factor", () => {
  it("refuses enrolment when the request's primary session has already ended", async () => {
    const h = await createHarness();
    const actor = await h.signIn(await h.seed.member());
    await h.as(actor).signOutEverywhere();

    await expect(
      h.as(actor).startTotpEnrolment({ label: "Authenticator" })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(h.as(actor).startPasskeyRegistration()).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("needs step-up once a factor exists", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const actor = await h.signIn(member);
    await h.passSecondFactor(actor);

    expect(
      await h.as(actor).startTotpEnrolment({ label: "Backup phone" })
    ).toMatchObject({ ok: true });

    h.clock.advance({ minutes: 11 });
    await expect(
      h.as(actor).startTotpEnrolment({ label: "Backup phone" })
    ).rejects.toMatchObject({ code: "step_up_required" });
  });

  it("can't be done from a session that only knows the email code", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    await h.passSecondFactor(await h.signIn(member));
    // Someone who got into the mailbox signs in on another device.
    const intruder = await h.signIn(member);

    await expect(
      h.as(intruder).startTotpEnrolment({ label: "Mine now" })
    ).rejects.toMatchObject({ code: "step_up_required" });
  });

  it("asks for step-up again at the code if the second factor went stale since adding started", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const actor = await h.signIn(member);
    await h.passSecondFactor(actor);
    h.clock.advance({ minutes: 9 });
    const started = await h
      .as(actor)
      .startTotpEnrolment({ label: "Backup phone" });
    if (!started.ok) throw new Error("Could not start");
    const confirm = () =>
      h.as(actor).confirmTotpEnrolment({
        factorId: started.factorId,
        code: totpCode(base32Decode(started.secret), h.clock.now()),
      });

    h.clock.advance({ minutes: 1, seconds: 1 });
    await expect(confirm()).rejects.toMatchObject({
      code: "step_up_required",
    });
    expect((await h.as(actor).mySecondFactors()).factors).toHaveLength(1);

    // The step-up screen asks for the factor again; then the code counts.
    await h.passSecondFactor(actor);
    expect(await confirm()).toEqual({ ok: true });
    expect((await h.as(actor).mySecondFactors()).factors).toHaveLength(2);
  });
});

describe("resetSecondFactors", () => {
  async function staffWithFactor(h: Harness) {
    const staff = await h.seed.member();
    await h.seed.grant(staff, { role: "finance", scope: { type: "global" } });
    const staffActor = await h.signIn(staff);
    return { staff, staffActor };
  }

  it("revokes the target's sessions and pending challenges so recovery starts with a fresh sign-in", async () => {
    const h = await createHarness();
    const { admin, actor } = await freshSuperAdmin(h);
    const { staff, staffActor } = await staffWithFactor(h);
    const verifiedBrowser = h.cookies.header();
    await h.as(staffActor).startPasskeyRegistration();
    await h.signIn(staff, undefined, { secondFactor: false });
    const primaryBrowser = h.cookies.header();
    const [factor] = await h.db
      .select({ id: secondFactor.id, label: secondFactor.label })
      .from(secondFactor)
      .where(eq(secondFactor.userId, staff.id));

    expect(await h.as(actor).resetSecondFactors({ userId: staff.id })).toEqual({
      ok: true,
      removed: 1,
    });

    expect((await h.currentActor(undefined, verifiedBrowser)).kind).toBe(
      "visitor"
    );
    expect((await h.currentActor(undefined, primaryBrowser)).kind).toBe(
      "visitor"
    );
    expect(
      await h.db
        .select({ purpose: webauthnChallenge.purpose })
        .from(webauthnChallenge)
    ).toEqual([]);
    expect(
      await h.db
        .select()
        .from(sessionSecondFactor)
        .where(eq(sessionSecondFactor.sessionId, sessionOf(staffActor)))
    ).toEqual([]);
    expect((await secondFactorAudit(h)).at(-1)).toEqual({
      action: "second_factor.reset",
      actorUserId: admin.id,
      actorRole: "super_admin",
      entityId: staff.id,
      before: {
        factors: [{ factorId: factor?.id, kind: "totp", label: factor?.label }],
      },
      after: null,
    });

    const recovered = await h.signIn(staff, undefined, { secondFactor: false });
    expect(await h.as(recovered).staffAccess()).toEqual({
      ok: false,
      code: "enrolment_required",
    });
    const started = await h
      .as(recovered)
      .startTotpEnrolment({ label: "Replacement" });
    if (!started.ok) throw new Error("Recovery enrolment did not start");
    expect(
      await h.as(recovered).confirmTotpEnrolment({
        factorId: started.factorId,
        code: totpCode(base32Decode(started.secret), h.clock.now()),
      })
    ).toEqual({ ok: true });
    expect(await h.as(recovered).staffAccess()).toEqual({
      ok: true,
      staff: true,
    });
  });

  it("clears a lockout too, so the user can enrol and verify again", async () => {
    const h = await createHarness();
    const { actor } = await freshSuperAdmin(h);
    const { staff } = await staffWithFactor(h);
    await h.db
      .insert(secondFactorLockout)
      .values({
        userId: staff.id,
        failures: 0,
        lockedUntil: new Date(h.clock.now().getTime() + 60_000),
      })
      .onConflictDoUpdate({
        target: secondFactorLockout.userId,
        set: { lockedUntil: new Date(h.clock.now().getTime() + 60_000) },
      });

    await h.as(actor).resetSecondFactors({ userId: staff.id });

    expect(
      await h.db
        .select()
        .from(secondFactorLockout)
        .where(eq(secondFactorLockout.userId, staff.id))
    ).toEqual([]);
  });

  it("needs step-up", async () => {
    const h = await createHarness();
    const { actor } = await freshSuperAdmin(h);
    const { staff } = await staffWithFactor(h);
    h.clock.advance({ minutes: 10, seconds: 1 });

    await expect(
      h.as(actor).resetSecondFactors({ userId: staff.id })
    ).rejects.toMatchObject({ code: "step_up_required" });
    expect(
      await h.db
        .select()
        .from(secondFactor)
        .where(eq(secondFactor.userId, staff.id))
    ).toHaveLength(1);
  });

  it("is for super admins only", async () => {
    const h = await createHarness();
    const { staff } = await staffWithFactor(h);
    const staffAdmin = await h.seed.member();
    await h.seed.grant(staffAdmin, {
      role: "staff_admin",
      scope: { type: "global" },
    });

    for (const actor of [
      await h.signIn(staffAdmin),
      await h.signIn(await h.seed.member()),
      h.visitor(),
    ] satisfies Actor[]) {
      await expect(
        h.as(actor).resetSecondFactors({ userId: staff.id })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});

describe("factor recovery atomicity", () => {
  it.each(["reset", "removal"] as const)(
    "preserves sessions, factors and pending challenges if the %s audit fails",
    async (operation) => {
      const h = await createHarness();
      const { actor: admin } = await freshSuperAdmin(h);
      const member = await h.seed.member();
      const actor = await h.signIn(member);
      await h.passSecondFactor(actor);
      const verifiedBrowser = h.cookies.header();
      await h.as(actor).startPasskeyRegistration();
      const before = await h.as(actor).mySecondFactors();
      const factor = before.factors[0];
      if (!factor) throw new Error("No factor");
      await h.signIn(member);
      const primaryBrowser = h.cookies.header();
      await h.db.$client.exec(`
        ALTER TABLE "audit_log" ADD CONSTRAINT "test_refuse_factor_change"
        CHECK (action NOT IN ('second_factor.removed', 'second_factor.reset'))
      `);

      const attempt =
        operation === "reset"
          ? h.as(admin).resetSecondFactors({ userId: member.id })
          : h.as(actor).removeSecondFactor({ factorId: factor.id });
      expect(await attempt.then(() => undefined, sqlState)).toBe("23514");

      expect((await h.currentActor(undefined, verifiedBrowser)).kind).toBe(
        "user"
      );
      expect((await h.currentActor(undefined, primaryBrowser)).kind).toBe(
        "user"
      );
      expect(await h.as(actor).mySecondFactors()).toEqual(before);
      expect(
        await h.db
          .select({ purpose: webauthnChallenge.purpose })
          .from(webauthnChallenge)
      ).toEqual([{ purpose: "register" }]);
    }
  );
});

function sessionOf(actor: Actor): string {
  if (actor.kind !== "user") throw new Error("Not signed in");
  return actor.sessionId;
}
