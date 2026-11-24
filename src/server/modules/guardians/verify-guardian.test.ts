import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createApp } from "@/server/app";
import { auditLog, guardian, userRole } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";

const SUNITA = { name: "Sunita Rao", email: "sunita@example.test" };
const DECLARATION = {
  fullName: "Sunita Rao",
  phone: "98765 43210",
  adultDeclared: true,
} as const;

async function signedInMember(h: Harness, details = SUNITA) {
  const member = await h.seed.member(details);
  return { member, actor: await h.signIn(member) };
}

async function guardianRoles(h: Harness, userId: string) {
  return h.db
    .select({ role: userRole.role })
    .from(userRole)
    .where(and(eq(userRole.userId, userId), eq(userRole.role, "guardian")));
}

describe("registerAsGuardian", () => {
  it.each(["production", "staging"] as const)(
    "leaves guardian setup unavailable in %s for a signed-in member",
    async (appEnv) => {
      const h = await createHarness({ appEnv });
      const { actor } = await signedInMember(h);

      expect(await h.as(actor).registerAsGuardian(DECLARATION)).toEqual({
        ok: false,
        error: "unavailable",
      });
      expect(await h.as(actor).myGuardianProfile()).toEqual({
        registered: false,
      });
    }
  );

  it("records a member's declaration as an unverified guardian", async () => {
    const h = await createHarness();
    const { actor } = await signedInMember(h);

    const result = await h.as(actor).registerAsGuardian(DECLARATION);

    expect(result).toEqual({ ok: true });
    expect(await h.as(actor).myGuardianProfile()).toEqual({
      registered: true,
      fullName: "Sunita Rao",
      phone: "+919876543210",
      verified: false,
      verifiedAt: null,
      codeTo: "s***@example.test",
    });
  });

  it("refuses without the adult and guardian declaration, storing nothing", async () => {
    const h = await createHarness();
    const { actor } = await signedInMember(h);

    const result = await h
      .as(actor)
      .registerAsGuardian({ ...DECLARATION, adultDeclared: false });

    expect(result).toEqual({ ok: false, error: "adult_declaration_required" });
    expect(await h.as(actor).myGuardianProfile()).toEqual({
      registered: false,
    });
  });

  it("asks again for a name or phone that can't be stored", async () => {
    const h = await createHarness();
    const { actor } = await signedInMember(h);

    expect(
      await h
        .as(actor)
        .registerAsGuardian({ ...DECLARATION, fullName: " ", phone: "12" })
    ).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["fullName", "phone"],
    });
  });

  it("keeps the latest details while unverified, and none after verifying", async () => {
    const h = await createHarness();
    const { member, actor } = await signedInMember(h);
    await h.as(actor).registerAsGuardian(DECLARATION);
    await h
      .as(actor)
      .registerAsGuardian({ fullName: "Sunita R. Rao", adultDeclared: true });
    expect(await h.as(actor).myGuardianProfile()).toMatchObject({
      fullName: "Sunita R. Rao",
      phone: null,
    });

    await h.as(actor).startGuardianVerification();
    await h.as(actor).confirmGuardianVerification({
      code: h.email.codeFor(member.email)!,
    });

    expect(await h.as(actor).registerAsGuardian(DECLARATION)).toEqual({
      ok: false,
      error: "already_verified",
    });
  });

  it("stores the name and phone encrypted, never as typed", async () => {
    const h = await createHarness();
    const { member, actor } = await signedInMember(h);
    await h.as(actor).registerAsGuardian(DECLARATION);

    const [row] = await h.db
      .select()
      .from(guardian)
      .where(eq(guardian.userId, member.id));
    const raw = JSON.stringify(row);
    expect(raw).not.toContain("Sunita");
    expect(raw).not.toContain("9876543210");
    expect(row?.phoneHash).toBe(
      h.deps.blindIndex.of("guardian.phone", "+919876543210")
    );
  });

  it("is refused to visitors", async () => {
    const h = await createHarness();
    await expect(
      h.as(h.visitor()).registerAsGuardian(DECLARATION)
    ).rejects.toThrow(DomainError);
    await expect(h.as(h.visitor()).myGuardianProfile()).rejects.toThrow(
      DomainError
    );
  });
});

describe("guardian verification by one-time code", () => {
  it("leaves verification and email delivery unavailable in production, even with a valid code", async () => {
    const h = await createHarness({ appEnv: "production" });
    const { member, actor } = await signedInMember(h);
    const preview = createApp({ ...h.deps, appEnv: "preview" }).as(actor);
    const production = h.as(actor);
    expect(await preview.registerAsGuardian(DECLARATION)).toEqual({ ok: true });
    expect(await preview.startGuardianVerification()).toMatchObject({
      ok: true,
    });
    const code = h.email.codeFor(member.email)!;
    const sent = h.email.sent.length;

    expect(await production.startGuardianVerification()).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(h.email.sent).toHaveLength(sent);
    expect(await production.confirmGuardianVerification({ code })).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(await production.myGuardianProfile()).toMatchObject({
      registered: true,
      verified: false,
    });
    expect(await guardianRoles(h, member.id)).toEqual([]);
    expect(await preview.confirmGuardianVerification({ code })).toEqual({
      ok: true,
    });
  });

  it("sends one code to the member's own verified email, directly", async () => {
    const h = await createHarness();
    const { member, actor } = await signedInMember(h);
    await h.as(actor).registerAsGuardian(DECLARATION);
    const before = h.email.sent.length;

    const result = await h.as(actor).startGuardianVerification();

    expect(result).toEqual({
      ok: true,
      sentTo: "s***@example.test",
      expiresAt: new Date(h.clock.now().getTime() + 10 * 60 * 1000),
    });
    expect(h.email.sent.length).toBe(before + 1);
    const message = h.email.lastTo(member.email);
    expect(message?.subject).toBe(
      "Your code to confirm you're a parent or guardian"
    );
    expect(h.email.codeFor(member.email)).toMatch(/^\d{6}$/);
  });

  it("verifies with the right code: dated, by email, with the guardian role and an audit entry", async () => {
    const h = await createHarness();
    const { member, actor } = await signedInMember(h);
    await h.as(actor).registerAsGuardian(DECLARATION);
    await h.as(actor).startGuardianVerification();
    h.clock.advance({ minutes: 3 });
    const verifiedAt = h.clock.now();

    const result = await h.as(actor).confirmGuardianVerification({
      code: h.email.codeFor(member.email)!,
    });

    expect(result).toEqual({ ok: true });
    expect(await h.as(actor).myGuardianProfile()).toMatchObject({
      verified: true,
      verifiedAt,
    });
    const [row] = await h.db
      .select({ method: guardian.verificationMethod })
      .from(guardian)
      .where(eq(guardian.userId, member.id));
    expect(row?.method).toBe("email_otp");
    expect(await guardianRoles(h, member.id)).toEqual([{ role: "guardian" }]);
    const entries = await h.db
      .select({ action: auditLog.action, after: auditLog.after })
      .from(auditLog)
      .where(eq(auditLog.actorUserId, member.id));
    expect(entries.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "guardian.registered",
        "guardian.verified",
        "role.granted",
      ])
    );
    expect(JSON.stringify(entries)).not.toContain("Sunita");
  });

  it("refuses a wrong code, and grants nothing", async () => {
    const h = await createHarness();
    const { member, actor } = await signedInMember(h);
    await h.as(actor).registerAsGuardian(DECLARATION);
    await h.as(actor).startGuardianVerification();
    const right = h.email.codeFor(member.email)!;
    const wrong = right === "000000" ? "111111" : "000000";

    expect(
      await h.as(actor).confirmGuardianVerification({ code: wrong })
    ).toEqual({ ok: false, error: "code_invalid" });
    expect(await h.as(actor).myGuardianProfile()).toMatchObject({
      verified: false,
    });
    expect(await guardianRoles(h, member.id)).toEqual([]);
  });

  it("refuses the code once it has expired", async () => {
    const h = await createHarness();
    const { member, actor } = await signedInMember(h);
    await h.as(actor).registerAsGuardian(DECLARATION);
    await h.as(actor).startGuardianVerification();
    h.clock.advance({ minutes: 10, seconds: 1 });

    expect(
      await h.as(actor).confirmGuardianVerification({
        code: h.email.codeFor(member.email)!,
      })
    ).toEqual({ ok: false, error: "code_expired" });
  });

  it("locks the code after five wrong guesses, even for the right one", async () => {
    const h = await createHarness();
    const { member, actor } = await signedInMember(h);
    await h.as(actor).registerAsGuardian(DECLARATION);
    await h.as(actor).startGuardianVerification();
    const right = h.email.codeFor(member.email)!;
    const wrong = right === "000000" ? "111111" : "000000";
    for (let guess = 0; guess < 5; guess += 1) {
      await h.as(actor).confirmGuardianVerification({ code: wrong });
    }

    expect(
      await h.as(actor).confirmGuardianVerification({ code: right })
    ).toEqual({ ok: false, error: "too_many_attempts" });
  });

  it("limits how many codes go to one address, as sign-in does", async () => {
    const h = await createHarness();
    const { actor } = await signedInMember(h);
    await h.as(actor).registerAsGuardian(DECLARATION);
    const results = [];
    // The sign-in code already took one of the address's allowance.
    for (let request = 0; request < 5; request += 1) {
      results.push(await h.as(actor).startGuardianVerification());
    }

    expect(results.at(-1)).toMatchObject({
      ok: false,
      error: "rate_limited",
    });
  });

  it("asks to register first, and refuses a guardian already verified", async () => {
    const h = await createHarness();
    const { member, actor } = await signedInMember(h);

    expect(await h.as(actor).startGuardianVerification()).toEqual({
      ok: false,
      error: "not_registered",
    });
    expect(
      await h.as(actor).confirmGuardianVerification({ code: "123456" })
    ).toEqual({ ok: false, error: "not_registered" });

    await h.as(actor).registerAsGuardian(DECLARATION);
    await h.as(actor).startGuardianVerification();
    await h.as(actor).confirmGuardianVerification({
      code: h.email.codeFor(member.email)!,
    });
    expect(await h.as(actor).startGuardianVerification()).toEqual({
      ok: false,
      error: "already_verified",
    });
  });

  it("can't send a code to an account with no email yet", async () => {
    const h = await createHarness();
    await h.settings.set("sms.enabled", true);
    const phoneOnly = await h.as(h.visitor()).requestPhoneCode({
      intent: "sign-up",
      name: "Kiran Shah",
      phone: "98765 11111",
    });
    expect(phoneOnly).toMatchObject({ ok: true });
    const signedUp = await h.as(h.visitor()).verifyPhoneCode({
      intent: "sign-up",
      name: "Kiran Shah",
      phone: "98765 11111",
      code: h.sms.codeFor("98765 11111")!,
    });
    expect(signedUp).toMatchObject({ ok: true });
    const actor = await h.currentActor();
    await h.as(actor).registerAsGuardian({
      fullName: "Kiran Shah",
      adultDeclared: true,
    });

    expect(await h.as(actor).startGuardianVerification()).toEqual({
      ok: false,
      error: "no_verified_email",
    });
  });

  it("is refused to visitors", async () => {
    const h = await createHarness();
    await expect(h.as(h.visitor()).startGuardianVerification()).rejects.toThrow(
      DomainError
    );
    await expect(
      h.as(h.visitor()).confirmGuardianVerification({ code: "123456" })
    ).rejects.toThrow(DomainError);
  });
});
