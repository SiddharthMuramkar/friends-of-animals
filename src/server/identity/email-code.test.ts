import { count, eq } from "drizzle-orm";
import { inspect } from "node:util";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { createApp } from "@/server/app";
import { user } from "@/server/db/schema";
import type { EmailSender } from "@/server/ports/email";
import { SEED_ACCOUNTS } from "@/server/seed";
import { createHarness, type Harness } from "@/test/harness";

const ASHA = "asha@example.test";

/** The code in the newest email to `address`; fails the test if none. */
function codeFor(h: Harness, address: string): string {
  const code = h.email.codeFor(address);
  if (!code) throw new Error(`No code was emailed to ${address}`);
  return code;
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

describe("requestEmailCode", () => {
  it("emails a 6-digit code that lasts 10 minutes", async () => {
    const h = await createHarness();

    const result = await h.as(h.visitor()).requestEmailCode({ email: ASHA });

    expect(result).toEqual({ ok: true });
    expect(codeFor(h, ASHA)).toMatch(/^\d{6}$/);
    expect(h.email.lastTo(ASHA)?.text).toContain("10 minutes");
  });

  it("refuses an address that isn't an email", async () => {
    const h = await createHarness();

    const result = await h
      .as(h.visitor())
      .requestEmailCode({ email: "not an email" });

    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["email"],
    });
    expect(h.email.sent).toEqual([]);
  });

  it("asks a sign-up for a name before sending a code", async () => {
    const h = await createHarness();

    const result = await h
      .as(h.visitor())
      .requestEmailCode({ intent: "sign-up", name: "  ", email: ASHA });

    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["name"],
    });
    expect(h.email.sent).toEqual([]);
  });

  it("sends a sign-up its code once it has a name", async () => {
    const h = await createHarness();

    const result = await h
      .as(h.visitor())
      .requestEmailCode({ intent: "sign-up", name: "Asha", email: ASHA });

    expect(result).toEqual({ ok: true });
    expect(codeFor(h, ASHA)).toMatch(/^\d{6}$/);
  });

  it("refuses a 6th code for one address within 15 minutes", async () => {
    const h = await createHarness();
    for (let i = 0; i < 5; i++) {
      expect(await h.as(h.visitor()).requestEmailCode({ email: ASHA })).toEqual(
        { ok: true }
      );
      h.clock.advance({ minutes: 1 });
    }

    const sixth = await h.as(h.visitor()).requestEmailCode({ email: ASHA });

    // The window opened at 04:30:00 and it is now 04:35:00.
    expect(sixth).toEqual({
      ok: false,
      error: "rate_limited",
      retryAfterSeconds: 600,
    });
    expect(h.email.sent).toHaveLength(5);
  });

  it("counts an address however it is typed", async () => {
    const h = await createHarness();
    for (const email of [ASHA, "ASHA@example.test", " Asha@Example.Test "]) {
      await h.as(h.visitor()).requestEmailCode({ email });
      await h.as(h.visitor()).requestEmailCode({ email });
    }
    expect(h.email.sent).toHaveLength(5);
  });

  it("sends codes again once the window has passed", async () => {
    const h = await createHarness();
    for (let i = 0; i < 6; i++) {
      await h.as(h.visitor()).requestEmailCode({ email: ASHA });
    }

    h.clock.advance({ minutes: 15 });

    expect(await h.as(h.visitor()).requestEmailCode({ email: ASHA })).toEqual({
      ok: true,
    });
  });

  it("refuses a 21st code from one IP, whatever the addresses", async () => {
    const h = await createHarness();
    const sameIp = h.visitor({ ip: "198.51.100.20" });
    for (let i = 1; i <= 20; i++) {
      expect(
        await h.as(sameIp).requestEmailCode({ email: `p${i}@example.test` })
      ).toEqual({ ok: true });
    }

    const refused = await h
      .as(sameIp)
      .requestEmailCode({ email: "p21@example.test" });
    const otherIp = await h
      .as(h.visitor({ ip: "198.51.100.21" }))
      .requestEmailCode({ email: "p21@example.test" });

    expect(refused).toMatchObject({ ok: false, error: "rate_limited" });
    expect(otherIp).toEqual({ ok: true });
  });

  it("counts every address in one IPv6 /64 network as one IP", async () => {
    const h = await createHarness();
    for (let i = 1; i <= 20; i++) {
      const ip = `2001:db8:1:2::${i.toString(16)}`;
      await h
        .as(h.visitor({ ip }))
        .requestEmailCode({ email: `p${i}@example.test` });
    }

    const sameNetwork = await h
      .as(h.visitor({ ip: "2001:db8:1:2:ffff:ffff:ffff:fffe" }))
      .requestEmailCode({ email: "p21@example.test" });
    const otherNetwork = await h
      .as(h.visitor({ ip: "2001:db8:1:3::1" }))
      .requestEmailCode({ email: "p21@example.test" });

    expect(sameNetwork).toMatchObject({ ok: false, error: "rate_limited" });
    expect(otherNetwork).toEqual({ ok: true });
  });

  it("counts an IPv4-mapped IPv6 address as its IPv4 address", async () => {
    const h = await createHarness();
    for (let i = 1; i <= 20; i++) {
      await h
        .as(h.visitor({ ip: "198.51.100.20" }))
        .requestEmailCode({ email: `p${i}@example.test` });
    }

    const mapped = await h
      .as(h.visitor({ ip: "::ffff:198.51.100.20" }))
      .requestEmailCode({ email: "p21@example.test" });

    expect(mapped).toMatchObject({ ok: false, error: "rate_limited" });
  });

  it("fails, and says so, when the code can't be sent", async () => {
    const h = await createHarness();
    h.email.failNext(1);

    await expect(
      h.as(h.visitor()).requestEmailCode({ email: ASHA })
    ).rejects.toThrow("FakeEmail: send failed");
    expect(h.email.sent).toEqual([]);
  });

  it("logs neither the address nor the code when a send fails", async () => {
    const h = await createHarness();
    // Like a failed insert into the capture mailbox, whose error message
    // lists the query's parameters: the address and the email's text.
    const leakyFailure: EmailSender = {
      async send(message) {
        throw new Error(`insert failed, params: ${message.to},${message.text}`);
      },
    };
    const app = createApp({ ...h.deps, email: leakyFailure });
    const logged = captureConsole();

    await app
      .as(h.visitor())
      .requestEmailCode({ email: ASHA })
      .catch(() => {});

    expect(logged()).not.toContain(ASHA);
    expect(logged()).not.toMatch(/\d{6}/);
  });

  it("is not for someone already signed in", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const signedIn = await h.signIn(member);

    await expect(
      h.as(signedIn).requestEmailCode({ email: ASHA })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("verifyEmailCode", () => {
  it("signs a visitor up and in with the emailed code", async () => {
    const h = await createHarness();
    await h.as(h.visitor()).requestEmailCode({ email: ASHA });

    const result = await h.as(h.visitor()).verifyEmailCode({
      intent: "sign-up",
      name: "Asha Rao",
      email: ASHA,
      code: codeFor(h, ASHA),
    });

    expect(result).toMatchObject({ ok: true, isNewAccount: true });
    const actor = await h.currentActor();
    expect(actor).toMatchObject({
      kind: "user",
      userId: result.ok ? result.userId : "",
    });
    const [account] = await h.db
      .select()
      .from(user)
      .where(eq(user.email, ASHA));
    expect(account).toMatchObject({ name: "Asha Rao", emailVerified: true });
  });

  it("signs a returning member in to the same account", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    await h.as(h.visitor()).requestEmailCode({ email: member.email });

    const result = await h.as(h.visitor()).verifyEmailCode({
      intent: "sign-in",
      email: member.email,
      code: codeFor(h, member.email),
    });

    expect(result).toEqual({
      ok: true,
      userId: member.id,
      isNewAccount: false,
    });
    expect(await h.currentActor()).toMatchObject({ userId: member.id });
    expect(await accountCount(h)).toBe(1);
  });

  it("signs in, not up, when someone signs up with an address that has an account", async () => {
    const h = await createHarness();
    const member = await h.seed.member({ name: "Ravi Kumar" });
    await h.as(h.visitor()).requestEmailCode({ email: member.email });

    const result = await h.as(h.visitor()).verifyEmailCode({
      intent: "sign-up",
      name: "Someone Else",
      email: member.email,
      code: codeFor(h, member.email),
    });

    expect(result).toEqual({
      ok: true,
      userId: member.id,
      isNewAccount: false,
    });
    const [account] = await h.db
      .select()
      .from(user)
      .where(eq(user.id, member.id));
    expect(account?.name).toBe("Ravi Kumar");
  });

  it("sends someone without an account to sign up, and creates none", async () => {
    const h = await createHarness();
    await h.as(h.visitor()).requestEmailCode({ email: ASHA });

    const result = await h.as(h.visitor()).verifyEmailCode({
      intent: "sign-in",
      email: ASHA,
      code: codeFor(h, ASHA),
    });

    expect(result).toEqual({ ok: false, error: "no_account" });
    expect(await accountCount(h)).toBe(0);
    expect((await h.currentActor()).kind).toBe("visitor");
  });

  it("tells nobody without the code whether an address has an account", async () => {
    const h = await createHarness();
    await h.as(h.visitor()).requestEmailCode({ email: ASHA });
    const wrong = codeFor(h, ASHA) === "000000" ? "111111" : "000000";

    const result = await h.as(h.visitor()).verifyEmailCode({
      intent: "sign-in",
      email: ASHA,
      code: wrong,
    });

    expect(result).toEqual({ ok: false, error: "code_invalid" });
  });

  it("accepts a code until 10 minutes have passed", async () => {
    const h = await createHarness();
    await h.as(h.visitor()).requestEmailCode({ email: ASHA });
    h.clock.advance({ minutes: 9, seconds: 59 });

    const result = await h.as(h.visitor()).verifyEmailCode({
      intent: "sign-up",
      name: "Asha Rao",
      email: ASHA,
      code: codeFor(h, ASHA),
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("refuses a code after 10 minutes", async () => {
    const h = await createHarness();
    await h.as(h.visitor()).requestEmailCode({ email: ASHA });
    h.clock.advance({ minutes: 10, seconds: 1 });

    const result = await h.as(h.visitor()).verifyEmailCode({
      intent: "sign-up",
      name: "Asha Rao",
      email: ASHA,
      code: codeFor(h, ASHA),
    });

    expect(result).toEqual({ ok: false, error: "code_expired" });
    expect(await accountCount(h)).toBe(0);
  });

  it("locks a code after 5 wrong guesses", async () => {
    const h = await createHarness();
    await h.as(h.visitor()).requestEmailCode({ email: ASHA });
    const right = codeFor(h, ASHA);
    const wrong = right === "000000" ? "111111" : "000000";
    const attempt = (code: string) =>
      h.as(h.visitor()).verifyEmailCode({
        intent: "sign-up",
        name: "Asha Rao",
        email: ASHA,
        code,
      });

    for (let i = 0; i < 5; i++) {
      expect(await attempt(wrong)).toEqual({
        ok: false,
        error: "code_invalid",
      });
    }

    expect(await attempt(right)).toEqual({
      ok: false,
      error: "too_many_attempts",
    });
  });

  it("refuses a code that was already used", async () => {
    const h = await createHarness();
    await h.as(h.visitor()).requestEmailCode({ email: ASHA });
    const input = {
      intent: "sign-up" as const,
      name: "Asha Rao",
      email: ASHA,
      code: codeFor(h, ASHA),
    };
    await h.as(h.visitor()).verifyEmailCode(input);

    expect(await h.as(h.visitor()).verifyEmailCode(input)).toEqual({
      ok: false,
      error: "code_invalid",
    });
  });

  it("asks for a name to sign up", async () => {
    const h = await createHarness();
    await h.as(h.visitor()).requestEmailCode({ email: ASHA });

    const result = await h.as(h.visitor()).verifyEmailCode({
      intent: "sign-up",
      name: "  ",
      email: ASHA,
      code: codeFor(h, ASHA),
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["name"],
    });
  });
});

describe("seeded accounts", () => {
  it("sign in by email code, as on a preview", async () => {
    const h = await createHarness();
    await h.seed.preview();

    for (const account of [
      SEED_ACCOUNTS.superAdmin,
      ...SEED_ACCOUNTS.members,
    ]) {
      h.cookies.clear();
      const actor = await h.signIn(account);
      expect(actor).toMatchObject({ kind: "user", userId: account.id });
    }
  });
});
