// Seam 1 for runtime settings (#62): the typed accessor and the settings
// use cases, on PGlite with the real migrations.

import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog, session, setting } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { readSetting } from "./index";

async function rowCounts(h: Harness) {
  const [settings] = await h.db.select({ n: count() }).from(setting);
  const [entries] = await h.db.select({ n: count() }).from(auditLog);
  return { settings: settings?.n, auditEntries: entries?.n };
}

/** Everyone who isn't a super admin: a staff admin, a member, a visitor. */
async function notSuperAdmins(h: Harness): Promise<[string, Actor][]> {
  const staffAdmin = await h.seed.member();
  await h.seed.grant(staffAdmin, {
    role: "staff_admin",
    scope: { type: "global" },
  });
  return [
    ["a staff admin", await h.signIn(staffAdmin)],
    ["a member", await h.signIn(await h.seed.member())],
    ["a visitor", h.visitor()],
  ];
}

describe("readSetting", () => {
  it("returns each setting's documented default on a fresh database", async () => {
    const h = await createHarness();

    expect(await readSetting(h.db, "auth.staffSessionHours")).toBe(12);
    expect(await readSetting(h.db, "sms.enabled")).toBe(false);
    expect(await readSetting(h.db, "org.has80G")).toBe(false);
    expect(await readSetting(h.db, "org.fcraEnabled")).toBe(false);
  });
});

describe("listSettings", () => {
  it("shows a super admin every setting in catalogue order, with its default and input", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());

    expect(await h.as(admin).listSettings()).toEqual([
      {
        key: "auth.staffSessionHours",
        value: 12,
        defaultValue: 12,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 24, unit: "hours" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "sms.enabled",
        value: false,
        defaultValue: false,
        source: "default",
        storedInvalid: false,
        input: { kind: "boolean" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "org.has80G",
        value: false,
        defaultValue: false,
        source: "default",
        storedInvalid: false,
        input: { kind: "boolean" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "org.fcraEnabled",
        value: false,
        defaultValue: false,
        source: "default",
        storedInvalid: false,
        input: { kind: "boolean" },
        updatedAt: null,
        updatedBy: null,
      },
    ]);
  });

  it("refuses anyone who isn't a super admin", async () => {
    const h = await createHarness();

    for (const [who, actor] of await notSuperAdmins(h)) {
      await expect(h.as(actor).listSettings(), who).rejects.toMatchObject({
        name: "DomainError",
        code: "forbidden",
      });
    }
  });
});

describe("changeSetting", () => {
  it("takes effect at once, with no deploy or restart", async () => {
    const h = await createHarness();
    const account = await h.seed.superAdmin({ name: "Sunita Admin" });
    const admin = await h.signIn(account);
    h.clock.advance({ minutes: 1 });

    expect(
      await h.as(admin).changeSetting({ key: "org.has80G", value: true })
    ).toEqual({ ok: true, changed: true });

    expect(await readSetting(h.db, "org.has80G")).toBe(true);
    const listed = await h.as(admin).listSettings();
    expect(listed.find((each) => each.key === "org.has80G")).toEqual({
      key: "org.has80G",
      value: true,
      defaultValue: false,
      source: "stored",
      storedInvalid: false,
      input: { kind: "boolean" },
      updatedAt: h.clock.now(),
      updatedBy: { id: account.id, name: "Sunita Admin" },
    });
  });

  it("records one audit entry per change, with the value before and after", async () => {
    const h = await createHarness();
    const account = await h.seed.superAdmin();
    const admin = await h.signIn(account, {
      ip: "198.51.100.20",
      userAgent: "Admin browser",
    });

    await h
      .as(admin)
      .changeSetting({ key: "auth.staffSessionHours", value: 8 });
    h.clock.advance({ minutes: 1 });
    await h
      .as(admin)
      .changeSetting({ key: "auth.staffSessionHours", value: 6 });

    const audit = await h.as(admin).searchAuditLog({ entityType: "setting" });
    expect(audit).toMatchObject({
      ok: true,
      entries: [
        {
          action: "setting.changed",
          entity: { type: "setting", id: "auth.staffSessionHours" },
          before: { value: 8, source: "stored" },
          after: { value: 6 },
        },
        {
          action: "setting.changed",
          entity: { type: "setting", id: "auth.staffSessionHours" },
          before: { value: 12, source: "default" },
          after: { value: 8 },
          actor: { kind: "user", userId: account.id, role: "super_admin" },
          ip: "198.51.100.20",
          userAgent: "Admin browser",
        },
      ],
    });
    expect(audit.ok && audit.entries).toHaveLength(2);
  });

  it("stores and records nothing when the value already applies", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());

    expect(
      await h.as(admin).changeSetting({ key: "org.has80G", value: false })
    ).toEqual({ ok: true, changed: false });
    expect(await rowCounts(h)).toEqual({ settings: 0, auditEntries: 0 });

    await h.as(admin).changeSetting({ key: "org.has80G", value: true });
    expect(
      await h.as(admin).changeSetting({ key: "org.has80G", value: true })
    ).toEqual({ ok: true, changed: false });
    expect(await rowCounts(h)).toEqual({ settings: 1, auditEntries: 1 });
  });

  it.each([
    { value: 0, problem: { reason: "too_small", min: 1 } },
    { value: 25, problem: { reason: "too_big", max: 24 } },
    // Past 2^53, zod's own safe-integer bound fails too; the setting's
    // bound is still the one to report.
    { value: 2 ** 53, problem: { reason: "too_big", max: 24 } },
    { value: 1e20, problem: { reason: "too_big", max: 24 } },
    { value: -1e20, problem: { reason: "too_small", min: 1 } },
    { value: 1.5, problem: { reason: "wrong_type" } },
    { value: "12", problem: { reason: "wrong_type" } },
    { value: null, problem: { reason: "wrong_type" } },
  ])(
    "refuses $value staff session hours, saying why, and changes nothing",
    async ({ value, problem }) => {
      const h = await createHarness();
      const admin = await h.signIn(await h.seed.superAdmin());

      expect(
        await h
          .as(admin)
          .changeSetting({ key: "auth.staffSessionHours", value })
      ).toEqual({ ok: false, error: "invalid_value", problem });

      expect(await rowCounts(h)).toEqual({ settings: 0, auditEntries: 0 });
      expect(await readSetting(h.db, "auth.staffSessionHours")).toBe(12);
    }
  );

  it.each(["org.unknown", "constructor", "__proto__", ""])(
    "refuses the unknown setting %j and changes nothing",
    async (key) => {
      const h = await createHarness();
      const admin = await h.signIn(await h.seed.superAdmin());

      expect(await h.as(admin).changeSetting({ key, value: true })).toEqual({
        ok: false,
        error: "unknown_setting",
      });
      expect(await rowCounts(h)).toEqual({ settings: 0, auditEntries: 0 });
    }
  );

  it("refuses anyone who isn't a super admin, and changes nothing", async () => {
    const h = await createHarness();

    for (const [who, actor] of await notSuperAdmins(h)) {
      await expect(
        h.as(actor).changeSetting({ key: "org.has80G", value: true }),
        who
      ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
    }
    expect(await rowCounts(h)).toEqual({ settings: 0, auditEntries: 0 });
  });

  it("needs a second factor passed in the last 10 minutes", async () => {
    const h = await createHarness();
    // Signing in passes the super admin's second factor (the harness).
    const admin = await h.signIn(await h.seed.superAdmin());
    const change = (value: boolean) =>
      h.as(admin).changeSetting({ key: "org.has80G", value });

    h.clock.advance({ minutes: 10, seconds: 1 });
    await expect(change(true)).rejects.toMatchObject({
      name: "DomainError",
      code: "step_up_required",
    });
    expect(await rowCounts(h)).toEqual({ settings: 0, auditEntries: 0 });

    await h.passSecondFactor(admin);
    h.clock.advance({ minutes: 9, seconds: 59 });
    expect(await change(true)).toEqual({ ok: true, changed: true });
  });
});

describe("the staff session lifetime setting", () => {
  const HOUR = 60 * 60 * 1000;

  async function storedExpiry(h: Harness, actor: Actor) {
    if (actor.kind !== "user") throw new Error("Not signed in");
    const [row] = await h.db
      .select({ expiresAt: session.expiresAt })
      .from(session)
      .where(eq(session.id, actor.sessionId));
    return row?.expiresAt;
  }

  /** A staff admin, signed in now; returns their browser's cookie. */
  async function staffSignsIn(h: Harness) {
    const staff = await h.seed.member();
    await h.seed.grant(staff, {
      role: "staff_admin",
      scope: { type: "global" },
    });
    const actor = await h.signIn(staff);
    return { actor, browser: h.cookies.header() };
  }

  const seenAs = async (h: Harness, browser: string) =>
    (await h.currentActor(undefined, browser)).kind;

  it("ends staff sessions that start afterwards that many hours after sign-in", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    await h
      .as(admin)
      .changeSetting({ key: "auth.staffSessionHours", value: 2 });

    h.clock.advance({ minutes: 1 });
    const signedInAt = h.clock.now().getTime();
    const { actor, browser } = await staffSignsIn(h);

    expect(await storedExpiry(h, actor)).toEqual(
      new Date(signedInAt + 2 * HOUR)
    );
    h.clock.advance({ hours: 1, minutes: 59 });
    expect(await seenAs(h, browser)).toBe("user");
    h.clock.advance({ minutes: 1 });
    expect(await seenAs(h, browser)).toBe("visitor");
  });

  it("ends a live staff session at once when the lifetime drops below its age", async () => {
    const h = await createHarness();
    const { browser } = await staffSignsIn(h);
    h.clock.advance({ hours: 3 });
    const admin = await h.signIn(await h.seed.superAdmin());

    await h
      .as(admin)
      .changeSetting({ key: "auth.staffSessionHours", value: 2 });

    expect(await seenAs(h, browser)).toBe("visitor");
  });

  it("never stretches a live staff session when the lifetime goes up", async () => {
    const h = await createHarness();
    const { actor, browser } = await staffSignsIn(h);
    const expiry = await storedExpiry(h, actor);
    const admin = await h.signIn(await h.seed.superAdmin());

    await h
      .as(admin)
      .changeSetting({ key: "auth.staffSessionHours", value: 24 });

    expect(await storedExpiry(h, actor)).toEqual(expiry);
    h.clock.advance({ hours: 12 });
    expect(await seenAs(h, browser)).toBe("visitor");
  });
});
