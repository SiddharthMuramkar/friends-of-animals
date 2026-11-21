import { asc, eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, secondFactor } from "@/server/db/schema";
import { createHarness, TEST_AUTH, type Harness } from "@/test/harness";
import { FakePasskey } from "@/test/fakes/passkey";

import type { Actor } from "../../actor";
import { base32Decode } from "./domain/base32";
import { totpCode } from "./domain/totp";

const ORIGIN = new URL(TEST_AUTH.baseUrl).origin;

/** Registers a new software passkey for `actor` and returns it. */
async function registerPasskey(h: Harness, actor: Actor, label = "Laptop") {
  const passkey = new FakePasskey({ origin: ORIGIN });
  const started = await h.as(actor).startPasskeyRegistration();
  if (!started.ok) throw new Error("Could not start registration");
  const finished = await h.as(actor).finishPasskeyRegistration({
    label,
    response: passkey.register(started.options),
  });
  expect(finished).toEqual({ ok: true });
  return passkey;
}

async function verifyWith(h: Harness, actor: Actor, passkey: FakePasskey) {
  const started = await h.as(actor).startPasskeyVerification();
  if (!started.ok) throw new Error(`Could not start: ${started.error}`);
  return h.as(actor).finishPasskeyVerification({
    response: passkey.authenticate(started.options),
  });
}

describe("passkeys", () => {
  it("asks for a passkey that verifies its user, bound to the site's host", async () => {
    const h = await createHarness();
    const member = await h.seed.member({ email: "asha@example.test" });
    const actor = await h.signIn(member);

    const started = await h.as(actor).startPasskeyRegistration();

    expect(started).toMatchObject({
      ok: true,
      options: {
        rp: { id: "localhost", name: "Friends of Animals" },
        user: { name: "asha@example.test" },
        attestation: "none",
        authenticatorSelection: { userVerification: "required" },
      },
    });
  });

  it("counts a registered passkey as a factor, verifying this session, and audits it", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const actor = await h.signIn(member);

    const passkey = await registerPasskey(h, actor, "MacBook");

    expect(await h.as(actor).mySecondFactors()).toMatchObject({
      verifiedAt: h.clock.now(),
      factors: [{ kind: "passkey", label: "MacBook" }],
    });
    const [row] = await h.db
      .select({ id: secondFactor.id, credentialId: secondFactor.credentialId })
      .from(secondFactor);
    expect(row?.credentialId).toBe(passkey.id);
    const entries = await h.db
      .select({ action: auditLog.action, after: auditLog.after })
      .from(auditLog)
      .where(like(auditLog.action, "second_factor.%"))
      .orderBy(asc(auditLog.id));
    expect(entries).toEqual([
      {
        action: "second_factor.enrolled",
        after: { factorId: row?.id, kind: "passkey", label: "MacBook" },
      },
    ]);
  });

  it("passes the second factor for a new session, and opens staff screens", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    await h.seed.grant(member, {
      role: "content_manager",
      scope: { type: "global" },
    });
    const first = await h.signIn(member, undefined, { secondFactor: false });
    const passkey = await registerPasskey(h, first);
    const second = await h.signIn(member, undefined, { secondFactor: false });
    expect(await h.as(second).staffAccess()).toEqual({
      ok: false,
      code: "second_factor_required",
    });

    expect(await verifyWith(h, second, passkey)).toEqual({ ok: true });

    expect(await h.as(second).staffAccess()).toEqual({ ok: true, staff: true });
  });

  it("refuses a passkey that didn't verify its user", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const passkey = await registerPasskey(h, await h.signIn(member));
    const actor = await h.signIn(member);
    passkey.userVerified = false;

    expect(await verifyWith(h, actor, passkey)).toEqual({
      ok: false,
      error: "not_verified",
    });
    expect(await h.as(actor).mySecondFactors()).toMatchObject({
      verifiedAt: null,
    });
    expect(
      await h.db
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.action, "second_factor.failed"))
    ).toEqual([{ after: { method: "passkey", reason: "not_verified" } }]);
  });

  it("refuses to register a passkey that doesn't verify its user", async () => {
    const h = await createHarness();
    const actor = await h.signIn(await h.seed.member());
    const passkey = new FakePasskey({ origin: ORIGIN });
    passkey.userVerified = false;
    const started = await h.as(actor).startPasskeyRegistration();
    if (!started.ok) throw new Error("Could not start");

    expect(
      await h.as(actor).finishPasskeyRegistration({
        label: "Key",
        response: passkey.register(started.options),
      })
    ).toEqual({ ok: false, error: "not_verified" });
    expect(await h.db.select().from(secondFactor)).toEqual([]);
  });

  it("refuses an answer made for another site", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const passkey = await registerPasskey(h, await h.signIn(member));
    const actor = await h.signIn(member);
    // A look-alike site relays the challenge; the browser signs for it.
    passkey.origin = "https://friends-of-animals.example";

    expect(await verifyWith(h, actor, passkey)).toEqual({
      ok: false,
      error: "not_verified",
    });
  });

  it("answers each challenge once, and only within 5 minutes", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const passkey = await registerPasskey(h, await h.signIn(member));
    const actor = await h.signIn(member);

    const started = await h.as(actor).startPasskeyVerification();
    if (!started.ok) throw new Error("Could not start");
    h.clock.advance({ minutes: 5, seconds: 1 });
    expect(
      await h.as(actor).finishPasskeyVerification({
        response: passkey.authenticate(started.options),
      })
    ).toEqual({ ok: false, error: "challenge_expired" });

    const again = await h.as(actor).startPasskeyVerification();
    if (!again.ok) throw new Error("Could not start");
    const response = passkey.authenticate(again.options);
    expect(await h.as(actor).finishPasskeyVerification({ response })).toEqual({
      ok: true,
    });
    expect(await h.as(actor).finishPasskeyVerification({ response })).toEqual({
      ok: false,
      error: "challenge_expired",
    });
  });

  it("refuses another user's passkey", async () => {
    const h = await createHarness();
    const asha = await h.seed.member();
    const ravi = await h.seed.member();
    const ashaKey = await registerPasskey(h, await h.signIn(asha));
    await registerPasskey(h, await h.signIn(ravi));
    const raviActor = await h.signIn(ravi);

    expect(await verifyWith(h, raviActor, ashaKey)).toEqual({
      ok: false,
      error: "not_verified",
    });
  });

  it("has nothing to verify for a user with no passkey", async () => {
    const h = await createHarness();
    const actor = await h.signIn(await h.seed.member());
    expect(await h.as(actor).startPasskeyVerification()).toEqual({
      ok: false,
      error: "not_enrolled",
    });
  });

  it("needs step-up to add a passkey once a factor exists", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    await registerPasskey(h, await h.signIn(member));
    const intruder = await h.signIn(member);

    await expect(
      h.as(intruder).startPasskeyRegistration()
    ).rejects.toMatchObject({ code: "step_up_required" });
  });

  it("needs step-up to finish a passkey started before the user enrolled another factor", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    // Someone who got into the mailbox starts a passkey of their own while
    // the user has no factor yet...
    const intruder = await h.signIn(member);
    const started = await h.as(intruder).startPasskeyRegistration();
    // ...and the user enrols an authenticator app meanwhile.
    await h.passSecondFactor(await h.signIn(member));

    await expect(
      h.as(intruder).finishPasskeyRegistration({
        label: "Mine",
        response: new FakePasskey({ origin: ORIGIN }).register(started.options),
      })
    ).rejects.toMatchObject({ code: "step_up_required" });
    expect(
      await h.db
        .select({ id: secondFactor.id })
        .from(secondFactor)
        .where(eq(secondFactor.kind, "passkey"))
    ).toEqual([]);
  });

  it("needs step-up to confirm an authenticator app started before the user enrolled a passkey, even days later", async () => {
    const h = await createHarness();
    const staff = await h.seed.member();
    await h.seed.grant(staff, {
      role: "content_manager",
      scope: { type: "global" },
    });
    const emailOnly = { secondFactor: false };
    // Someone who got into the mailbox signs in before the staff member
    // has a factor, and starts an authenticator app with a secret they know.
    const planting = await h.signIn(staff, undefined, emailOnly);
    const planted = await h.as(planting).startTotpEnrolment({ label: "Mine" });
    if (!planted.ok) throw new Error("Could not start");
    // The staff member enrols a passkey.
    await registerPasskey(h, await h.signIn(staff, undefined, emailOnly));
    // Days later the intruder signs in by email code again.
    h.clock.advance({ days: 2 });
    const intruder = await h.signIn(staff, undefined, emailOnly);

    await expect(
      h.as(intruder).confirmTotpEnrolment({
        factorId: planted.factorId,
        code: totpCode(base32Decode(planted.secret), h.clock.now()),
      })
    ).rejects.toMatchObject({ code: "step_up_required" });
    expect(await h.as(intruder).staffAccess()).toEqual({
      ok: false,
      code: "second_factor_required",
    });
    expect(await h.as(intruder).mySecondFactors()).toMatchObject({
      verifiedAt: null,
      factors: [{ kind: "passkey" }],
    });
  });

  it("drops authenticator apps still waiting for their first code once a passkey is added", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const elsewhere = await h.signIn(member);
    const pending = await h.as(elsewhere).startTotpEnrolment({ label: "App" });
    if (!pending.ok) throw new Error("Could not start");

    await registerPasskey(h, await h.signIn(member));

    expect(
      await h.db
        .select({ kind: secondFactor.kind, label: secondFactor.label })
        .from(secondFactor)
    ).toEqual([{ kind: "passkey", label: "Laptop" }]);
  });

  it("records the passkey's signature counter", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const passkey = await registerPasskey(h, await h.signIn(member));
    await verifyWith(h, await h.signIn(member), passkey);

    const [row] = await h.db
      .select({ signCount: secondFactor.signCount })
      .from(secondFactor)
      .where(eq(secondFactor.credentialId, passkey.id));
    expect(row?.signCount).toBe(1);
  });

  it("refuses visitors", async () => {
    const h = await createHarness();
    await expect(
      h.as(h.visitor()).startPasskeyRegistration()
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      h.as(h.visitor()).startPasskeyVerification()
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
