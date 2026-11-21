import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { otpRateLimit, verification } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

// Sign-in by phone while SMS is switched off, and the limits on how many
// codes one phone, or one IP across phones and email, may ask for.

const PHONE = "+91 98765 43210";

async function harness({ sms }: { sms: "on" | "off" }) {
  const h = await createHarness();
  h.settings.set("sms.enabled", sms === "on");
  return h;
}

async function rows(
  h: Harness,
  table: typeof verification | typeof otpRateLimit
) {
  const [row] = await h.db.select({ n: count() }).from(table);
  return row?.n;
}

/** The nth of a run of different Indian mobile numbers. */
function nthPhone(n: number): string {
  return `+91 98000 ${String(100000 + n).slice(1)}`;
}

describe("while SMS is switched off", () => {
  it("texts no code, stores none and counts nothing against the limits", async () => {
    const h = await harness({ sms: "off" });

    const result = await h.as(h.visitor()).requestPhoneCode({ phone: PHONE });

    expect(result).toEqual({ ok: false, error: "sms_disabled" });
    expect(h.sms.sent).toEqual([]);
    expect(await rows(h, verification)).toBe(0);
    expect(await rows(h, otpRateLimit)).toBe(0);
  });

  it("takes no code texted before it was switched off", async () => {
    const h = await harness({ sms: "on" });
    await h.as(h.visitor()).requestPhoneCode({ phone: PHONE });
    const code = h.sms.codeFor(PHONE) ?? "";
    h.settings.set("sms.enabled", false);

    const result = await h.as(h.visitor()).verifyPhoneCode({
      intent: "sign-up",
      name: "Asha Rao",
      phone: PHONE,
      code,
    });

    expect(result).toEqual({ ok: false, error: "sms_disabled" });
    expect((await h.currentActor()).kind).toBe("visitor");
  });

  it("still signs people in by email", async () => {
    const h = await harness({ sms: "off" });
    const member = await h.seed.member();

    expect(await h.signIn(member)).toMatchObject({
      kind: "user",
      userId: member.id,
    });
  });
});

describe("signInMethods", () => {
  it("says email is always on, and phone only while SMS is", async () => {
    const h = await harness({ sms: "off" });

    expect(await h.as(h.visitor()).signInMethods()).toEqual({
      email: true,
      phone: false,
    });

    h.settings.set("sms.enabled", true);
    expect(await h.as(h.visitor()).signInMethods()).toEqual({
      email: true,
      phone: true,
    });
  });

  it("answers a signed-in user too, but not the platform itself", async () => {
    const h = await harness({ sms: "on" });
    const signedIn = await h.signIn(await h.seed.member());

    expect(await h.as(signedIn).signInMethods()).toEqual({
      email: true,
      phone: true,
    });
    await expect(
      h.as({ kind: "system", process: "seed" }).signInMethods()
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("limits on phone codes", () => {
  it("refuses a 6th code for one phone within 15 minutes, saying when to try again", async () => {
    const h = await harness({ sms: "on" });
    const ask = () => h.as(h.visitor()).requestPhoneCode({ phone: PHONE });

    for (let i = 0; i < 5; i++) expect(await ask()).toEqual({ ok: true });
    h.clock.advance({ minutes: 5 });

    expect(await ask()).toEqual({
      ok: false,
      error: "rate_limited",
      retryAfterSeconds: expect.any(Number),
    });
    expect(h.sms.sent).toHaveLength(5);
  });

  it("counts a phone however it is typed, from any IP", async () => {
    const h = await harness({ sms: "on" });
    const spellings = [
      "+91 98765 43210",
      "098765 43210",
      "9876543210",
      "+91-98765-43210",
      "0091 98765 43210",
    ];
    for (const [n, phone] of spellings.entries()) {
      await h
        .as(h.visitor({ ip: `198.51.100.${n}` }))
        .requestPhoneCode({ phone });
    }

    expect(
      await h
        .as(h.visitor({ ip: "198.51.100.99" }))
        .requestPhoneCode({ phone: "919876543210" })
    ).toMatchObject({ ok: false, error: "rate_limited" });
  });

  it("texts codes again once the 15 minutes have passed", async () => {
    const h = await harness({ sms: "on" });
    const ask = () => h.as(h.visitor()).requestPhoneCode({ phone: PHONE });
    for (let i = 0; i < 5; i++) await ask();

    h.clock.advance({ minutes: 15 });

    expect(await ask()).toEqual({ ok: true });
  });

  it("refuses a 21st code for one phone in a day", async () => {
    const h = await harness({ sms: "on" });
    const ask = () => h.as(h.visitor()).requestPhoneCode({ phone: PHONE });
    for (let window = 0; window < 4; window++) {
      for (let i = 0; i < 5; i++) expect(await ask()).toEqual({ ok: true });
      h.clock.advance({ minutes: 15 });
    }

    const refused = await ask();

    expect(refused).toMatchObject({ ok: false, error: "rate_limited" });
    expect(
      refused.ok === false && "retryAfterSeconds" in refused
        ? refused.retryAfterSeconds
        : 0
    ).toBeGreaterThan(15 * 60);
    expect(h.sms.sent).toHaveLength(20);
  });

  it("refuses a 21st code from one IP across phones and email together", async () => {
    const h = await harness({ sms: "on" });
    const visitor = h.visitor({ ip: "198.51.100.7" });
    for (let n = 0; n < 10; n++) {
      expect(
        await h
          .as(visitor)
          .requestEmailCode({ email: `person${n}@example.test` })
      ).toEqual({ ok: true });
      expect(
        await h.as(visitor).requestPhoneCode({ phone: nthPhone(n) })
      ).toEqual({ ok: true });
    }

    expect(
      await h.as(visitor).requestPhoneCode({ phone: nthPhone(20) })
    ).toMatchObject({ ok: false, error: "rate_limited" });
    expect(
      await h.as(visitor).requestEmailCode({ email: "person20@example.test" })
    ).toMatchObject({ ok: false, error: "rate_limited" });
    expect(h.sms.sent).toHaveLength(10);

    h.clock.advance({ minutes: 15 });
    expect(
      await h.as(visitor).requestPhoneCode({ phone: nthPhone(20) })
    ).toEqual({ ok: true });
  });

  it("keeps the number out of the limit counters", async () => {
    const h = await harness({ sms: "on" });

    await h.as(h.visitor()).requestPhoneCode({ phone: PHONE });

    const counters = await h.db.select().from(otpRateLimit);
    expect(counters.map((row) => row.scope).toSorted()).toEqual([
      "ip",
      "phone",
      "phone_day",
    ]);
    expect(JSON.stringify(counters)).not.toContain("9876543210");
  });
});
