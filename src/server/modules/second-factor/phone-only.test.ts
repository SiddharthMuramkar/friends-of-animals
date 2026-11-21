import { describe, expect, it } from "vitest";

import { createHarness, TEST_AUTH, type Harness } from "@/test/harness";
import { FakePasskey } from "@/test/fakes/passkey";

import { base32Decode } from "./domain/base32";
import { totpCode } from "./domain/totp";

// An account made by phone (#58) has no email address. Its authenticator
// app and its passkeys name it by its phone number instead.

const PHONE = "+91 98765 43210";

/**
 * A staff admin who signed up by phone, so has no email address, signed in
 * through the real SMS-code flow.
 */
async function phoneOnlyStaff(h: Harness) {
  h.settings.set("sms.enabled", true);
  await h
    .as(h.visitor())
    .requestPhoneCode({ intent: "sign-up", name: "Asha Rao", phone: PHONE });
  const code = h.sms.codeFor(PHONE);
  if (!code) throw new Error("No code was texted");
  const signedUp = await h.as(h.visitor()).verifyPhoneCode({
    intent: "sign-up",
    name: "Asha Rao",
    phone: PHONE,
    code,
  });
  if (!signedUp.ok) throw new Error(`Phone sign-up failed: ${signedUp.error}`);
  await h.seed.grant(
    { id: signedUp.userId },
    { role: "staff_admin", scope: { type: "global" } }
  );
  const actor = await h.currentActor();
  expect(await h.as(actor).getAccount()).toMatchObject({ email: null });
  return actor;
}

describe("a staff member with no email address", () => {
  it("adds an authenticator app named by their phone number, and passes the staff gate with it", async () => {
    const h = await createHarness();
    const actor = await phoneOnlyStaff(h);
    expect(await h.as(actor).staffAccess()).toEqual({
      ok: false,
      code: "enrolment_required",
    });

    const started = await h.as(actor).startTotpEnrolment({ label: "Phone" });

    expect(started).toMatchObject({ ok: true });
    if (!started.ok) return;
    expect(started.uri).toBe(
      `otpauth://totp/Friends%20of%20Animals:%2B91%2098765%2043210?secret=${started.secret}&issuer=Friends%20of%20Animals&algorithm=SHA1&digits=6&period=30`
    );
    const code = totpCode(base32Decode(started.secret), h.clock.now());
    expect(
      await h
        .as(actor)
        .confirmTotpEnrolment({ factorId: started.factorId, code })
    ).toEqual({ ok: true });
    expect(await h.as(actor).staffAccess()).toEqual({ ok: true, staff: true });
  });

  it("adds a passkey named by their phone number, and passes the staff gate with it", async () => {
    const h = await createHarness();
    const actor = await phoneOnlyStaff(h);

    const started = await h.as(actor).startPasskeyRegistration();

    expect(started).toMatchObject({
      ok: true,
      options: { user: { name: PHONE, displayName: "Asha Rao" } },
    });
    const passkey = new FakePasskey({
      origin: new URL(TEST_AUTH.baseUrl).origin,
    });
    expect(
      await h.as(actor).finishPasskeyRegistration({
        label: "Laptop",
        response: passkey.register(started.options),
      })
    ).toEqual({ ok: true });
    expect(await h.as(actor).staffAccess()).toEqual({ ok: true, staff: true });
  });
});
