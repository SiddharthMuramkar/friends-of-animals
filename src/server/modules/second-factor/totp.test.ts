import { and, asc, eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, secondFactor } from "@/server/db/schema";
import { seedPreview, SEED_ACCOUNTS } from "@/server/seed";
import { SEED_TOTP_SECRET } from "@/server/seed/second-factor";
import { createHarness, type Harness } from "@/test/harness";

import type { Actor } from "../../actor";
import { base32Decode } from "./domain/base32";
import { totpCode } from "./domain/totp";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** Second-factor audit entries, oldest first. */
function secondFactorAudit(h: Harness) {
  return h.db
    .select({
      action: auditLog.action,
      actorUserId: auditLog.actorUserId,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .where(like(auditLog.action, "second_factor.%"))
    .orderBy(asc(auditLog.id));
}

/** A well-formed code that no step of drift around `at` accepts. */
function wrongCodeFor(secret: Uint8Array, at: Date): string {
  const window = [-1, 0, 1].map((step) =>
    totpCode(secret, new Date(at.getTime() + step * 30 * SECOND))
  );
  return ["000000", "111111", "222222", "333333"].find(
    (code) => !window.includes(code)
  )!;
}

/** Enrols an authenticator app for `actor` and returns its secret. */
async function enrolTotp(h: Harness, actor: Actor, label = "My phone") {
  const started = await h.as(actor).startTotpEnrolment({ label });
  if (!started.ok) throw new Error(`Could not start: ${started.error}`);
  const secret = base32Decode(started.secret);
  const confirmed = await h.as(actor).confirmTotpEnrolment({
    factorId: started.factorId,
    code: totpCode(secret, h.clock.now()),
  });
  expect(confirmed).toEqual({ ok: true });
  return secret;
}

describe("startTotpEnrolment and confirmTotpEnrolment", () => {
  it("enrols an authenticator app, and its first code passes the second factor for this session", async () => {
    const h = await createHarness();
    const member = await h.seed.member({ email: "asha@example.test" });
    const actor = await h.signIn(member);

    const started = await h.as(actor).startTotpEnrolment({ label: "Pixel 7" });
    expect(started).toMatchObject({ ok: true });
    if (!started.ok) return;
    // The key a person types by hand, and the link the QR code holds.
    expect(started.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(started.uri).toBe(
      `otpauth://totp/Friends%20of%20Animals:asha%40example.test?secret=${started.secret}&issuer=Friends%20of%20Animals&algorithm=SHA1&digits=6&period=30`
    );

    const code = totpCode(base32Decode(started.secret), h.clock.now());
    expect(
      await h
        .as(actor)
        .confirmTotpEnrolment({ factorId: started.factorId, code })
    ).toEqual({ ok: true });

    expect(await h.as(actor).mySecondFactors()).toEqual({
      ok: true,
      staff: false,
      verifiedAt: h.clock.now(),
      factors: [
        {
          id: started.factorId,
          kind: "totp",
          label: "Pixel 7",
          createdAt: h.clock.now(),
        },
      ],
    });
  });

  it("writes second_factor.enrolled, without the secret or the code", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const actor = await h.signIn(member);

    const started = await h.as(actor).startTotpEnrolment({ label: "Phone" });
    if (!started.ok) throw new Error(started.error);
    const code = totpCode(base32Decode(started.secret), h.clock.now());
    await h
      .as(actor)
      .confirmTotpEnrolment({ factorId: started.factorId, code });

    const entries = await secondFactorAudit(h);
    expect(entries).toEqual([
      {
        action: "second_factor.enrolled",
        actorUserId: member.id,
        entityType: "user",
        entityId: member.id,
        before: null,
        after: { factorId: started.factorId, kind: "totp", label: "Phone" },
      },
    ]);
    const written = JSON.stringify(entries);
    expect(written).not.toContain(started.secret);
    expect(written).not.toContain(code);
  });

  it("stores the secret sealed, never as typed", async () => {
    const h = await createHarness();
    const actor = await h.signIn(await h.seed.member());

    const started = await h.as(actor).startTotpEnrolment({ label: "Phone" });
    if (!started.ok) throw new Error(started.error);

    const [row] = await h.db
      .select({ sealed: secondFactor.totpSecretSealed })
      .from(secondFactor)
      .where(eq(secondFactor.id, started.factorId));
    expect(row?.sealed).toMatch(/^v1\./);
    expect(row?.sealed).not.toContain(started.secret);
  });

  it("keeps a factor pending, counting for nothing, until a right code confirms it", async () => {
    const h = await createHarness();
    const actor = await h.signIn(await h.seed.member());

    const started = await h.as(actor).startTotpEnrolment({ label: "Phone" });
    if (!started.ok) throw new Error(started.error);
    const secret = base32Decode(started.secret);
    const stale = totpCode(secret, new Date(h.clock.now().getTime() - MINUTE));

    expect(
      await h
        .as(actor)
        .confirmTotpEnrolment({ factorId: started.factorId, code: stale })
    ).toEqual({ ok: false, error: "wrong_code" });
    expect(await h.as(actor).mySecondFactors()).toMatchObject({
      factors: [],
      verifiedAt: null,
    });
    expect(
      await h
        .as(actor)
        .verifySecondFactor({ code: totpCode(secret, h.clock.now()) })
    ).toEqual({ ok: false, error: "not_enrolled" });
    expect(await secondFactorAudit(h)).toEqual([]);
  });

  it("starting again replaces a pending factor", async () => {
    const h = await createHarness();
    const actor = await h.signIn(await h.seed.member());

    const first = await h.as(actor).startTotpEnrolment({ label: "Old" });
    const second = await h.as(actor).startTotpEnrolment({ label: "New" });
    if (!first.ok || !second.ok) throw new Error("Could not start");

    const code = totpCode(base32Decode(first.secret), h.clock.now());
    expect(
      await h.as(actor).confirmTotpEnrolment({ factorId: first.factorId, code })
    ).toEqual({ ok: false, error: "not_found" });
    expect(await h.db.select().from(secondFactor)).toHaveLength(1);
  });

  it("refuses to confirm another user's pending factor", async () => {
    const h = await createHarness();
    const asha = await h.signIn(await h.seed.member());
    const ravi = await h.signIn(await h.seed.member());

    const started = await h.as(asha).startTotpEnrolment({ label: "Phone" });
    if (!started.ok) throw new Error(started.error);
    const code = totpCode(base32Decode(started.secret), h.clock.now());

    expect(
      await h
        .as(ravi)
        .confirmTotpEnrolment({ factorId: started.factorId, code })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("refuses visitors", async () => {
    const h = await createHarness();
    await expect(
      h.as(h.visitor()).startTotpEnrolment({ label: "Phone" })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      h.as(h.visitor()).verifySecondFactor({ code: "123456" })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(h.as(h.visitor()).mySecondFactors()).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("rejects a label that is empty or too long", async () => {
    const h = await createHarness();
    const actor = await h.signIn(await h.seed.member());
    for (const label of ["  ", "x".repeat(61)]) {
      expect(await h.as(actor).startTotpEnrolment({ label })).toEqual({
        ok: false,
        error: "invalid_input",
        fields: ["label"],
      });
    }
  });
});

describe("verifySecondFactor", () => {
  it("passes the second factor for this session only", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const laptop = await h.signIn(member);
    const secret = await enrolTotp(h, laptop);
    const phone = await h.signIn(member);
    const tablet = await h.signIn(member);
    h.clock.advance({ seconds: 30 });

    expect(
      await h
        .as(phone)
        .verifySecondFactor({ code: totpCode(secret, h.clock.now()) })
    ).toEqual({ ok: true });

    expect(await h.as(phone).mySecondFactors()).toMatchObject({
      verifiedAt: h.clock.now(),
    });
    expect(await h.as(tablet).mySecondFactors()).toMatchObject({
      verifiedAt: null,
    });
  });

  it("follows the injected clock: a code two steps old is refused", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const secret = await enrolTotp(h, await h.signIn(member));
    const actor = await h.signIn(member);
    h.clock.advance({ minutes: 5 });

    const twoStepsOld = totpCode(
      secret,
      new Date(h.clock.now().getTime() - 60 * SECOND)
    );
    expect(await h.as(actor).verifySecondFactor({ code: twoStepsOld })).toEqual(
      { ok: false, error: "wrong_code" }
    );
    expect(
      await h
        .as(actor)
        .verifySecondFactor({ code: totpCode(secret, h.clock.now()) })
    ).toEqual({ ok: true });
  });

  it("accepts a code once: the same code can't be replayed in another session", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const secret = await enrolTotp(h, await h.signIn(member));
    const first = await h.signIn(member);
    const second = await h.signIn(member);
    h.clock.advance({ minutes: 1 });
    const code = totpCode(secret, h.clock.now());

    expect(await h.as(first).verifySecondFactor({ code })).toEqual({
      ok: true,
    });
    expect(await h.as(second).verifySecondFactor({ code })).toEqual({
      ok: false,
      error: "code_used",
    });
  });

  it("audits a wrong code, locks after the fifth in 15 minutes, and refuses even the right code while locked", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const secret = await enrolTotp(h, await h.signIn(member));
    const actor = await h.signIn(member);
    h.clock.advance({ minutes: 1 });
    const wrong = () =>
      h.as(actor).verifySecondFactor({
        code: wrongCodeFor(secret, h.clock.now()),
      });

    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(await wrong()).toEqual({ ok: false, error: "wrong_code" });
      h.clock.advance({ minutes: 3 });
    }
    // The fifth, 12 minutes after the first: still inside the window.
    expect(await wrong()).toEqual({
      ok: false,
      error: "locked",
      retryAfterSeconds: 15 * 60,
    });

    const entries = await secondFactorAudit(h);
    expect(entries.map((entry) => entry.action)).toEqual([
      "second_factor.enrolled",
      "second_factor.failed",
      "second_factor.failed",
      "second_factor.failed",
      "second_factor.failed",
      "second_factor.failed",
      "second_factor.locked",
    ]);
    expect(entries.at(-1)).toMatchObject({
      entityType: "user",
      entityId: member.id,
      after: {
        lockedUntil: new Date(
          h.clock.now().getTime() + 15 * MINUTE
        ).toISOString(),
      },
    });

    h.clock.advance({ minutes: 14, seconds: 59 });
    expect(
      await h
        .as(actor)
        .verifySecondFactor({ code: totpCode(secret, h.clock.now()) })
    ).toEqual({ ok: false, error: "locked", retryAfterSeconds: 1 });

    h.clock.advance({ seconds: 1 });
    expect(
      await h
        .as(actor)
        .verifySecondFactor({ code: totpCode(secret, h.clock.now()) })
    ).toEqual({ ok: true });
  });

  it("forgets failures after a success", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const secret = await enrolTotp(h, await h.signIn(member));
    const actor = await h.signIn(member);
    h.clock.advance({ minutes: 1 });
    const wrongCode = wrongCodeFor(secret, h.clock.now());

    for (let attempt = 1; attempt <= 4; attempt++) {
      await h.as(actor).verifySecondFactor({ code: wrongCode });
    }
    expect(
      await h
        .as(actor)
        .verifySecondFactor({ code: totpCode(secret, h.clock.now()) })
    ).toEqual({ ok: true });
    h.clock.advance({ seconds: 30 });
    expect(await h.as(actor).verifySecondFactor({ code: wrongCode })).toEqual({
      ok: false,
      error: "wrong_code",
    });
  });

  it("counts failures per user, across sessions", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const secret = await enrolTotp(h, await h.signIn(member));
    const [laptop, phone, tablet] = [
      await h.signIn(member),
      await h.signIn(member),
      await h.signIn(member),
    ];
    h.clock.advance({ minutes: 1 });
    const wrong = { code: wrongCodeFor(secret, h.clock.now()) };

    for (const actor of [laptop, laptop, phone, phone]) {
      expect(await h.as(actor).verifySecondFactor(wrong)).toEqual({
        ok: false,
        error: "wrong_code",
      });
    }
    expect(await h.as(tablet).verifySecondFactor(wrong)).toEqual({
      ok: false,
      error: "locked",
      retryAfterSeconds: 15 * 60,
    });
  });

  it("rejects a code that isn't six digits without counting it", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    await enrolTotp(h, await h.signIn(member));
    const actor = await h.signIn(member);

    expect(await h.as(actor).verifySecondFactor({ code: "12a456" })).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["code"],
    });
    expect(
      (await secondFactorAudit(h)).filter(
        (entry) => entry.action === "second_factor.failed"
      )
    ).toEqual([]);
  });
});

describe("the preview seed", () => {
  it("gives seeded staff an authenticator with the known secret, which passes the second factor", async () => {
    const h = await createHarness();
    await seedPreview(h.deps);
    const admin = await h.signIn(SEED_ACCOUNTS.superAdmin, undefined, {
      secondFactor: false,
    });

    const code = totpCode(base32Decode(SEED_TOTP_SECRET), h.clock.now());
    expect(await h.as(admin).verifySecondFactor({ code })).toEqual({
      ok: true,
    });
  });

  it("gives every seeded staff account a factor, and no one else", async () => {
    const h = await createHarness();
    await seedPreview(h.deps);
    await seedPreview(h.deps);

    const [asha, ravi, meera] = SEED_ACCOUNTS.members;
    const factorsOf = (userId: string) =>
      h.db
        .select({ kind: secondFactor.kind, label: secondFactor.label })
        .from(secondFactor)
        .where(
          and(eq(secondFactor.userId, userId), eq(secondFactor.kind, "totp"))
        );
    const seededFactor = [{ kind: "totp", label: "Seed authenticator" }];
    expect(await factorsOf(SEED_ACCOUNTS.superAdmin.id)).toEqual(seededFactor);
    expect(await factorsOf(asha.id)).toEqual(seededFactor);
    expect(await factorsOf(ravi.id)).toEqual(seededFactor);
    expect(await factorsOf(meera.id)).toEqual([]);
  });
});
