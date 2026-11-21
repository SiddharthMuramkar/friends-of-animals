import { count, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { outbox, user } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

const ASHA = "asha@example.test";

/** The code in the newest email to `address`; fails the test if none. */
function codeFor(h: Harness, address: string): string {
  const code = h.email.codeFor(address);
  if (!code) throw new Error(`No code was emailed to ${address}`);
  return code;
}

async function signUp(h: Harness, name: string, email: string) {
  const visitor = h.visitor();
  await h.as(visitor).requestEmailCode({ intent: "sign-up", name, email });
  return h.as(visitor).verifyEmailCode({
    intent: "sign-up",
    name,
    email,
    code: codeFor(h, email),
  });
}

async function countRows(h: Harness, table: typeof user | typeof outbox) {
  const [row] = await h.db.select({ n: count() }).from(table);
  return row?.n;
}

describe("signing up", () => {
  it("saves one welcome event with the account, and the drain emails the welcome", async () => {
    const h = await createHarness();

    const result = await signUp(h, "Asha Rao", ASHA);

    expect(result).toMatchObject({ ok: true, isNewAccount: true });
    const userId = result.ok ? result.userId : "";
    const rows = await h.db.select().from(outbox);
    expect(rows).toEqual([
      expect.objectContaining({
        eventType: "identity.user_signed_up",
        handler: "notifications.send_welcome_email",
        aggregateType: "user",
        aggregateId: userId,
        payload: { userId },
        status: "pending",
        occurredAt: h.clock.now(),
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain(ASHA);

    expect(await h.drain()).toMatchObject({ dispatched: 1, failed: 0 });
    const welcome = h.email.lastTo(ASHA);
    expect(welcome?.subject).toBe("Welcome to Friends of Animals");
    expect(welcome?.text).toContain("Hello Asha Rao,");
  });

  it("saves neither the account nor its event when saving the event fails", async () => {
    const h = await createHarness();
    const visitor = h.visitor();
    await h.as(visitor).requestEmailCode({
      intent: "sign-up",
      name: "Asha Rao",
      email: ASHA,
    });
    const code = codeFor(h, ASHA);
    // A fault in the database itself, not a mocked module: any insert into
    // the outbox fails, so the account's transaction must roll back.
    await h.db.execute(sql`
      CREATE FUNCTION refuse_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'outbox refused'; END $$`);
    await h.db.execute(sql`
      CREATE TRIGGER refuse_outbox BEFORE INSERT ON outbox
      FOR EACH ROW EXECUTE FUNCTION refuse_outbox()`);

    await expect(
      h.as(visitor).verifyEmailCode({
        intent: "sign-up",
        name: "Asha Rao",
        email: ASHA,
        code,
      })
    ).rejects.toThrow();
    expect(await countRows(h, user)).toBe(0);
    expect(await countRows(h, outbox)).toBe(0);
    expect((await h.currentActor()).kind).toBe("visitor");

    // Once the outbox works again, the same code finishes the sign-up.
    await h.db.execute(sql`DROP TRIGGER refuse_outbox ON outbox`);
    const retried = await h.as(visitor).verifyEmailCode({
      intent: "sign-up",
      name: "Asha Rao",
      email: ASHA,
      code,
    });
    expect(retried).toMatchObject({ ok: true, isNewAccount: true });
    expect(await countRows(h, user)).toBe(1);
    expect(await countRows(h, outbox)).toBe(1);
  });

  it("saves nothing for a wrong code", async () => {
    const h = await createHarness();
    const visitor = h.visitor();
    await h.as(visitor).requestEmailCode({
      intent: "sign-up",
      name: "Asha Rao",
      email: ASHA,
    });
    const wrong = codeFor(h, ASHA) === "000000" ? "111111" : "000000";

    const result = await h.as(visitor).verifyEmailCode({
      intent: "sign-up",
      name: "Asha Rao",
      email: ASHA,
      code: wrong,
    });

    expect(result).toEqual({ ok: false, error: "code_invalid" });
    expect(await countRows(h, user)).toBe(0);
    expect(await countRows(h, outbox)).toBe(0);
  });

  it("emits nothing when the new member signs in again", async () => {
    const h = await createHarness();
    await signUp(h, "Asha Rao", ASHA);
    await h.drain();

    await h.signIn({ email: ASHA });

    expect(await countRows(h, outbox)).toBe(1);
    expect(await h.drain()).toMatchObject({ dispatched: 0 });
    const welcomes = h.email
      .inbox(ASHA)
      .filter((message) => message.subject === "Welcome to Friends of Animals");
    expect(welcomes).toHaveLength(1);
  });

  it("emits nothing when someone signs up with an address that has an account", async () => {
    const h = await createHarness();
    const member = await h.seed.member({ name: "Ravi Kumar" });

    const result = await signUp(h, "Someone Else", member.email);

    expect(result).toMatchObject({ ok: true, isNewAccount: false });
    expect(await countRows(h, outbox)).toBe(0);
  });
});
