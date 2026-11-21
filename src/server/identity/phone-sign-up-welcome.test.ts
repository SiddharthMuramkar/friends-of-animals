import { count, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { outbox, user } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

// A phone sign-up makes an account like an email sign-up does: the account
// and its identity.user_signed_up event in one transaction. The welcome
// email then has no address to go to.

const PHONE = "+91 98765 43210";

async function smsOn() {
  const h = await createHarness();
  h.settings.set("sms.enabled", true);
  return h;
}

function codeFor(h: Harness): string {
  const code = h.sms.codeFor(PHONE);
  if (!code) throw new Error("No code was texted");
  return code;
}

async function countRows(h: Harness, table: typeof user | typeof outbox) {
  const [row] = await h.db.select({ n: count() }).from(table);
  return row?.n;
}

const signUp = { intent: "sign-up" as const, name: "Asha Rao", phone: PHONE };

describe("signing up by phone", () => {
  it("saves one welcome event with the account, and the drain emails no one", async () => {
    const h = await smsOn();
    await h.as(h.visitor()).requestPhoneCode(signUp);

    const result = await h
      .as(h.visitor())
      .verifyPhoneCode({ ...signUp, code: codeFor(h) });

    expect(result).toMatchObject({ ok: true, isNewAccount: true });
    const userId = result.ok ? result.userId : "";
    const rows = await h.db.select().from(outbox);
    expect(rows).toEqual([
      expect.objectContaining({
        eventType: "identity.user_signed_up",
        aggregateId: userId,
        payload: { userId },
        status: "pending",
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain("9876543210");

    expect(await h.drain()).toMatchObject({ dispatched: 1, failed: 0 });
    expect(h.email.sent).toEqual([]);
  });

  it("saves neither the account nor its event when saving the event fails, and keeps the code", async () => {
    const h = await smsOn();
    await h.as(h.visitor()).requestPhoneCode(signUp);
    const code = codeFor(h);
    await h.db.execute(sql`
      CREATE FUNCTION refuse_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'outbox refused'; END $$`);
    await h.db.execute(sql`
      CREATE TRIGGER refuse_outbox BEFORE INSERT ON outbox
      FOR EACH ROW EXECUTE FUNCTION refuse_outbox()`);

    await expect(
      h.as(h.visitor()).verifyPhoneCode({ ...signUp, code })
    ).rejects.toThrow();
    expect(await countRows(h, user)).toBe(0);
    expect(await countRows(h, outbox)).toBe(0);
    expect((await h.currentActor()).kind).toBe("visitor");

    // Once the outbox works again, the same code finishes the sign-up.
    await h.db.execute(sql`DROP TRIGGER refuse_outbox ON outbox`);
    expect(
      await h.as(h.visitor()).verifyPhoneCode({ ...signUp, code })
    ).toMatchObject({ ok: true, isNewAccount: true });
    expect(await countRows(h, user)).toBe(1);
    expect(await countRows(h, outbox)).toBe(1);
  });

  it("emits nothing when the phone member signs in again", async () => {
    const h = await smsOn();
    await h.as(h.visitor()).requestPhoneCode(signUp);
    await h.as(h.visitor()).verifyPhoneCode({ ...signUp, code: codeFor(h) });
    h.cookies.clear();

    await h.as(h.visitor()).requestPhoneCode({ phone: PHONE });
    const again = await h
      .as(h.visitor())
      .verifyPhoneCode({ intent: "sign-in", phone: PHONE, code: codeFor(h) });

    expect(again).toMatchObject({ ok: true, isNewAccount: false });
    expect(await countRows(h, outbox)).toBe(1);
  });
});
