import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createApp } from "@/server/app";
import { otpRateLimit, verification } from "@/server/db/schema";
import { settingsFor } from "@/server/deps";
import { createHarness, type Harness } from "@/test/harness";

// Sign-up and sign-in by email while email sign-in is off: switched off on
// the settings screen (`auth.emailSignIn`), or in production until SES can
// send to anyone (DECISIONS R-27). The pages then say sign-in opens soon.

const ASHA = "asha@example.test";

async function harness({ email }: { email: "on" | "off" }) {
  const h = await createHarness();
  await h.settings.set("auth.emailSignIn", email === "on");
  return h;
}

async function rows(
  h: Harness,
  table: typeof verification | typeof otpRateLimit
) {
  const [row] = await h.db.select({ n: count() }).from(table);
  return row?.n;
}

describe("while email sign-in is off", () => {
  it("emails no code, stores none and counts nothing against the limits", async () => {
    const h = await harness({ email: "off" });

    const signIn = await h.as(h.visitor()).requestEmailCode({ email: ASHA });
    const signUp = await h.as(h.visitor()).requestEmailCode({
      intent: "sign-up",
      name: "Asha Rao",
      email: ASHA,
    });

    expect(signIn).toEqual({ ok: false, error: "email_disabled" });
    expect(signUp).toEqual({ ok: false, error: "email_disabled" });
    expect(h.email.sent).toEqual([]);
    expect(await rows(h, verification)).toBe(0);
    expect(await rows(h, otpRateLimit)).toBe(0);
  });

  it("takes no code emailed before it was switched off", async () => {
    const h = await harness({ email: "on" });
    await h.as(h.visitor()).requestEmailCode({ email: ASHA });
    const code = h.email.codeFor(ASHA) ?? "";
    await h.settings.set("auth.emailSignIn", false);

    const result = await h.as(h.visitor()).verifyEmailCode({
      intent: "sign-up",
      name: "Asha Rao",
      email: ASHA,
      code,
    });

    expect(result).toEqual({ ok: false, error: "email_disabled" });
    expect((await h.currentActor()).kind).toBe("visitor");
  });

  it("emails codes again once it is switched back on", async () => {
    const h = await harness({ email: "off" });
    await h.settings.set("auth.emailSignIn", true);

    const result = await h.as(h.visitor()).requestEmailCode({ email: ASHA });

    expect(result).toEqual({ ok: true });
    expect(h.email.codeFor(ASHA)).toMatch(/^\d{6}$/);
  });

  it("is still not for someone already signed in, nor for the platform", async () => {
    const h = await harness({ email: "on" });
    const signedIn = await h.signIn(await h.seed.member());
    await h.settings.set("auth.emailSignIn", false);

    await expect(
      h.as(signedIn).requestEmailCode({ email: ASHA })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      h.as({ kind: "system", process: "seed" }).requestEmailCode({
        email: ASHA,
      })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("signInMethods, for email", () => {
  it("says email is on by default, and off while switched off", async () => {
    const h = await createHarness();

    expect((await h.as(h.visitor()).signInMethods()).email).toBe(true);

    await h.settings.set("auth.emailSignIn", false);
    expect((await h.as(h.visitor()).signInMethods()).email).toBe(false);
  });
});

describe("production before SES can send to anyone", () => {
  function production(h: Harness) {
    return createApp({
      ...h.deps,
      settings: settingsFor(h.deps.settings, { emailSignInReady: false }),
    });
  }

  it("keeps email sign-in off even when switched on, and sends nothing", async () => {
    const h = await harness({ email: "on" });
    const app = production(h);

    expect((await app.as(h.visitor()).signInMethods()).email).toBe(false);
    expect(await app.as(h.visitor()).requestEmailCode({ email: ASHA })).toEqual(
      { ok: false, error: "email_disabled" }
    );
    expect(h.email.sent).toEqual([]);
  });
});
