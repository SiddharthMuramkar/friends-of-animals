import { count } from "drizzle-orm";
import { inspect } from "node:util";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { createApp } from "@/server/app";
import { user, verification } from "@/server/db/schema";
import type { SmsSender } from "@/server/ports/sms";
import { SEED_ACCOUNTS } from "@/server/seed";
import { createHarness, type Harness } from "@/test/harness";

// Sign-up and sign-in by SMS code, with SMS switched on. The switch
// itself and the limits are in ./phone-limits.test.ts.

const PHONE = "+91 98765 43210";
const E164 = "+919876543210";
const NATIONAL = "9876543210";

async function smsOn() {
  const h = await createHarness();
  h.settings.set("sms.enabled", true);
  return h;
}

/** The code in the newest text to `phone`; fails the test if none. */
function codeFor(h: Harness, phone: string): string {
  const code = h.sms.codeFor(phone);
  if (!code) throw new Error("No code was texted");
  return code;
}

/** A six-digit code that isn't `right`. */
function wrongCode(right: string): string {
  return right === "000000" ? "111111" : "000000";
}

/** Everything written to the console from now until the test ends. */
function captureConsole(): () => string {
  const lines: string[] = [];
  for (const method of ["debug", "info", "log", "warn", "error"] as const) {
    const spy = vi.spyOn(console, method).mockImplementation((...args) => {
      lines.push(args.map((arg) => inspect(arg, { depth: 5 })).join(" "));
    });
    onTestFinished(() => spy.mockRestore());
  }
  return () => lines.join("\n");
}

async function accountCount(h: Harness) {
  const [row] = await h.db.select({ n: count() }).from(user);
  return row?.n;
}

async function rawUsers(h: Harness) {
  const { rows } = await h.db.$client.query<Record<string, unknown>>(
    'select * from "user"'
  );
  return rows;
}

/** Signs `phone` up through the real flow and returns the new user's id. */
async function signUpByPhone(h: Harness, phone: string, name = "Asha Rao") {
  await h.as(h.visitor()).requestPhoneCode({ intent: "sign-up", name, phone });
  const result = await h.as(h.visitor()).verifyPhoneCode({
    intent: "sign-up",
    name,
    phone,
    code: codeFor(h, phone),
  });
  if (!result.ok) throw new Error(`Phone sign-up failed: ${result.error}`);
  return result.userId;
}

describe("requestPhoneCode", () => {
  it("texts a 6-digit code that lasts 10 minutes", async () => {
    const h = await smsOn();

    const result = await h.as(h.visitor()).requestPhoneCode({ phone: PHONE });

    expect(result).toEqual({ ok: true });
    const sms = h.sms.lastTo(E164);
    expect(sms).toMatchObject({ to: E164, template: "sign-in-code" });
    expect(sms?.vars).toEqual({ code: codeFor(h, E164), minutes: "10" });
    expect(sms?.text).toContain(codeFor(h, E164));
    expect(sms?.text).toContain("10 minutes");
    expect(h.sms.sent).toHaveLength(1);
  });

  it("refuses a number that isn't a mobile", async () => {
    const h = await smsOn();

    for (const phone of ["12345", "022 2345 6789", "phone"]) {
      expect(await h.as(h.visitor()).requestPhoneCode({ phone })).toEqual({
        ok: false,
        error: "invalid_input",
        fields: ["phone"],
      });
    }
    expect(h.sms.sent).toEqual([]);
  });

  it("points a number from another country to email", async () => {
    const h = await smsOn();

    const result = await h
      .as(h.visitor())
      .requestPhoneCode({ phone: "+44 7700 900123" });

    expect(result).toEqual({ ok: false, error: "unsupported_country" });
    expect(h.sms.sent).toEqual([]);
  });

  it("stores the code under the phone's blind index, not the number", async () => {
    const h = await smsOn();

    await h.as(h.visitor()).requestPhoneCode({ phone: PHONE });

    const rows = await h.db.select().from(verification);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(NATIONAL);
    expect(JSON.stringify(rows)).not.toContain(codeFor(h, E164));
  });

  it("asks a sign-up for a name before texting a code", async () => {
    const h = await smsOn();

    const result = await h
      .as(h.visitor())
      .requestPhoneCode({ intent: "sign-up", name: "  ", phone: PHONE });

    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["name"],
    });
    expect(h.sms.sent).toEqual([]);
  });

  it("fails, and says so, when the text can't be sent", async () => {
    const h = await smsOn();
    h.sms.failNext(1);

    await expect(
      h.as(h.visitor()).requestPhoneCode({ phone: PHONE })
    ).rejects.toThrow("FakeSms: send failed");
    expect(h.sms.sent).toEqual([]);
  });

  it("logs neither the number nor the code when a send fails", async () => {
    const h = await smsOn();
    // Like a failed insert into the capture mailbox, whose error message
    // lists the query's parameters: the number and the text.
    const leakyFailure: SmsSender = {
      async send(message) {
        throw new Error(`insert failed, params: ${message.to},${message.text}`);
      },
    };
    const app = createApp({ ...h.deps, sms: leakyFailure });
    const logged = captureConsole();

    await app
      .as(h.visitor())
      .requestPhoneCode({ phone: PHONE })
      .catch(() => {});

    expect(logged()).not.toContain(NATIONAL);
    expect(logged()).not.toMatch(/\d{6}/);
  });

  it("is not for someone already signed in", async () => {
    const h = await smsOn();
    const signedIn = await h.signIn(await h.seed.member());

    await expect(
      h.as(signedIn).requestPhoneCode({ phone: PHONE })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(h.sms.sent).toEqual([]);
  });
});

describe("verifyPhoneCode", () => {
  it("signs a visitor up and in with the texted code", async () => {
    const h = await smsOn();
    await h
      .as(h.visitor())
      .requestPhoneCode({ intent: "sign-up", name: "Asha Rao", phone: PHONE });

    const result = await h.as(h.visitor()).verifyPhoneCode({
      intent: "sign-up",
      name: "Asha Rao",
      phone: PHONE,
      code: codeFor(h, E164),
    });

    expect(result).toMatchObject({ ok: true, isNewAccount: true });
    const actor = await h.currentActor();
    expect(actor).toMatchObject({
      kind: "user",
      userId: result.ok ? result.userId : "",
    });
    expect(await h.as(actor).getAccount()).toEqual({
      name: "Asha Rao",
      email: null,
      phone: E164,
    });
  });

  it("stores the new account's phone encrypted, found by its blind index", async () => {
    const h = await smsOn();

    const userId = await signUpByPhone(h, PHONE);

    const rows = await rawUsers(h);
    expect(JSON.stringify(rows)).not.toContain(NATIONAL);
    expect(rows).toEqual([
      expect.objectContaining({
        id: userId,
        email: null,
        phone_hash: h.deps.blindIndex.of("user.phone", E164),
        phone_verified: true,
      }),
    ]);
    expect(
      h.deps.cipher.decrypt("user.phone", String(rows[0]?.phone_ciphertext))
    ).toBe(E164);
  });

  it("signs one phone in to one account, however the number is typed", async () => {
    const h = await smsOn();
    const userId = await signUpByPhone(h, "+91 98765 43210");

    for (const phone of ["098765 43210", "9876543210", "+91-98765-43210"]) {
      h.cookies.clear();
      await h.as(h.visitor()).requestPhoneCode({ phone });
      const result = await h.as(h.visitor()).verifyPhoneCode({
        intent: "sign-in",
        phone,
        code: codeFor(h, phone),
      });

      expect(result).toEqual({ ok: true, userId, isNewAccount: false });
      expect(await h.currentActor()).toMatchObject({ userId });
    }
    expect(await accountCount(h)).toBe(1);
  });

  it("signs in, not up, when someone signs up with a phone that has an account", async () => {
    const h = await smsOn();
    const userId = await signUpByPhone(h, PHONE, "Ravi Kumar");
    h.cookies.clear();

    await h.as(h.visitor()).requestPhoneCode({
      intent: "sign-up",
      name: "Someone Else",
      phone: PHONE,
    });
    const result = await h.as(h.visitor()).verifyPhoneCode({
      intent: "sign-up",
      name: "Someone Else",
      phone: PHONE,
      code: codeFor(h, PHONE),
    });

    expect(result).toEqual({ ok: true, userId, isNewAccount: false });
    expect(await accountCount(h)).toBe(1);
  });

  it("sends someone without an account to sign up, and creates none", async () => {
    const h = await smsOn();
    await h.as(h.visitor()).requestPhoneCode({ phone: PHONE });

    const result = await h.as(h.visitor()).verifyPhoneCode({
      intent: "sign-in",
      phone: PHONE,
      code: codeFor(h, PHONE),
    });

    expect(result).toEqual({ ok: false, error: "no_account" });
    expect(await accountCount(h)).toBe(0);
    expect((await h.currentActor()).kind).toBe("visitor");
  });

  it("tells nobody without the code whether a phone has an account", async () => {
    const h = await smsOn();
    await h.as(h.visitor()).requestPhoneCode({ phone: PHONE });

    const result = await h.as(h.visitor()).verifyPhoneCode({
      intent: "sign-in",
      phone: PHONE,
      code: wrongCode(codeFor(h, PHONE)),
    });

    expect(result).toEqual({ ok: false, error: "code_invalid" });
  });

  it("accepts a code until 10 minutes have passed, and not after", async () => {
    const h = await smsOn();
    const attempt = () =>
      h.as(h.visitor()).verifyPhoneCode({
        intent: "sign-up",
        name: "Asha Rao",
        phone: PHONE,
        code: codeFor(h, PHONE),
      });

    await h.as(h.visitor()).requestPhoneCode({ phone: PHONE });
    h.clock.advance({ minutes: 10, seconds: 1 });
    expect(await attempt()).toEqual({ ok: false, error: "code_expired" });
    expect(await accountCount(h)).toBe(0);

    await h.as(h.visitor()).requestPhoneCode({ phone: PHONE });
    h.clock.advance({ minutes: 9, seconds: 59 });
    expect(await attempt()).toMatchObject({ ok: true });
  });

  it("locks a code after 5 wrong guesses", async () => {
    const h = await smsOn();
    await h.as(h.visitor()).requestPhoneCode({ phone: PHONE });
    const right = codeFor(h, PHONE);
    const attempt = (code: string) =>
      h.as(h.visitor()).verifyPhoneCode({
        intent: "sign-up",
        name: "Asha Rao",
        phone: PHONE,
        code,
      });

    for (let i = 0; i < 5; i++) {
      expect(await attempt(wrongCode(right))).toEqual({
        ok: false,
        error: "code_invalid",
      });
    }

    expect(await attempt(right)).toEqual({
      ok: false,
      error: "too_many_attempts",
    });
    expect(await accountCount(h)).toBe(0);
  });

  it("refuses a code that was already used", async () => {
    const h = await smsOn();
    await h.as(h.visitor()).requestPhoneCode({ phone: PHONE });
    const input = {
      intent: "sign-up" as const,
      name: "Asha Rao",
      phone: PHONE,
      code: codeFor(h, PHONE),
    };
    await h.as(h.visitor()).verifyPhoneCode(input);
    h.cookies.clear();

    expect(await h.as(h.visitor()).verifyPhoneCode(input)).toEqual({
      ok: false,
      error: "code_invalid",
    });
  });

  it("only takes the newest code", async () => {
    const h = await smsOn();
    await h.as(h.visitor()).requestPhoneCode({ phone: PHONE });
    const first = codeFor(h, PHONE);
    await h.as(h.visitor()).requestPhoneCode({ phone: PHONE });
    const second = codeFor(h, PHONE);
    const attempt = (code: string) =>
      h.as(h.visitor()).verifyPhoneCode({
        intent: "sign-up",
        name: "Asha Rao",
        phone: PHONE,
        code,
      });

    if (first !== second) {
      expect(await attempt(first)).toEqual({
        ok: false,
        error: "code_invalid",
      });
    }
    expect(await attempt(second)).toMatchObject({ ok: true });
  });

  it("asks for a name to sign up, and for a real number and code", async () => {
    const h = await smsOn();

    expect(
      await h.as(h.visitor()).verifyPhoneCode({
        intent: "sign-up",
        name: " ",
        phone: "12345",
        code: "12a456",
      })
    ).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["name", "phone", "code"],
    });
  });

  it("is not for someone already signed in", async () => {
    const h = await smsOn();
    const signedIn = await h.signIn(await h.seed.member());

    await expect(
      h
        .as(signedIn)
        .verifyPhoneCode({ intent: "sign-in", phone: PHONE, code: "123456" })
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("logs neither the number nor a code through a whole sign-up", async () => {
    const h = await smsOn();
    const logged = captureConsole();

    await signUpByPhone(h, PHONE);

    expect(logged()).not.toContain(NATIONAL);
    expect(logged()).not.toMatch(/\d{6}/);
  });
});

describe("a seeded account with an email and a phone", () => {
  it("signs in by phone and by email, to the same account", async () => {
    const h = await smsOn();
    await h.seed.preview();
    const accountsBeforeSignIn = await accountCount(h);
    const member1 = SEED_ACCOUNTS.members[0];

    await h.as(h.visitor()).requestPhoneCode({ phone: "+91 90000 00101" });
    const byPhone = await h.as(h.visitor()).verifyPhoneCode({
      intent: "sign-in",
      phone: "+91 90000 00101",
      code: codeFor(h, "+919000000101"),
    });
    expect(byPhone).toEqual({
      ok: true,
      userId: member1.id,
      isNewAccount: false,
    });
    expect(await h.as(await h.currentActor()).getAccount()).toEqual({
      name: "Asha Rao",
      email: "member1@example.test",
      phone: "+919000000101",
    });

    h.cookies.clear();
    const byEmail = await h.signIn(member1);
    expect(byEmail).toMatchObject({ kind: "user", userId: member1.id });
    expect(await accountCount(h)).toBe(accountsBeforeSignIn);
  });
});
