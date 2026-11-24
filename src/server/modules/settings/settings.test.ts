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
    expect(await readSetting(h.db, "sms.maxPerHour")).toBe(200);
    expect(await readSetting(h.db, "sms.maxPerDay")).toBe(1000);
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
        key: "auth.emailSignIn",
        value: true,
        defaultValue: true,
        source: "default",
        storedInvalid: false,
        input: { kind: "boolean" },
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
        key: "sms.maxPerHour",
        value: 200,
        defaultValue: 200,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 1000, unit: "texts" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "sms.maxPerDay",
        value: 1000,
        defaultValue: 1000,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 5000, unit: "texts" },
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
      {
        key: "org.legalName",
        value: "",
        defaultValue: "",
        source: "default",
        storedInvalid: false,
        input: { kind: "text", maxLength: 200 },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "org.registrationType",
        value: "",
        defaultValue: "",
        source: "default",
        storedInvalid: false,
        input: { kind: "text", maxLength: 100 },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "org.registrationNumber",
        value: "",
        defaultValue: "",
        source: "default",
        storedInvalid: false,
        input: { kind: "text", maxLength: 50 },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "org.pan",
        value: "",
        defaultValue: "",
        source: "default",
        storedInvalid: false,
        input: { kind: "text", maxLength: 10 },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "donations.enabled",
        value: false,
        defaultValue: false,
        source: "default",
        storedInvalid: false,
        input: { kind: "boolean" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "donations.allowGuest",
        value: true,
        defaultValue: true,
        source: "default",
        storedInvalid: false,
        input: { kind: "boolean" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "donations.minAmountRupees",
        value: 100,
        defaultValue: 100,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 100_000, unit: "rupees" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "donations.maxAmountRupees",
        value: 100_000,
        defaultValue: 100_000,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 10_000_000, unit: "rupees" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "donations.pendingExpiryHours",
        value: 24,
        defaultValue: 24,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 168, unit: "hours" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "safeguarding.reportsPerIpPerHour",
        value: 10,
        defaultValue: 10,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 100, unit: "reports" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "breach.authorityEmail",
        value: "",
        defaultValue: "",
        source: "default",
        storedInvalid: false,
        input: { kind: "text", maxLength: 254 },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "reminders.entrySubmissionDueFirstHours",
        value: 72,
        defaultValue: 72,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 0, max: 720, unit: "hours" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "reminders.entrySubmissionDueSecondHours",
        value: 24,
        defaultValue: 24,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 0, max: 720, unit: "hours" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "retention.enforce",
        value: false,
        defaultValue: false,
        source: "default",
        storedInvalid: false,
        input: { kind: "boolean" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "retention.expiredVerificationsDays",
        value: 1,
        defaultValue: 1,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 7305, unit: "days" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "retention.expiredSessionsDays",
        value: 30,
        defaultValue: 30,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 7305, unit: "days" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "retention.capturedMessagesDays",
        value: 30,
        defaultValue: 30,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 7305, unit: "days" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "retention.messageDeliveriesDays",
        value: 365,
        defaultValue: 365,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 7305, unit: "days" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "retention.readInboxItemsDays",
        value: 365,
        defaultValue: 365,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 7305, unit: "days" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "retention.quarantinedFilesDays",
        value: 30,
        defaultValue: 30,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 7305, unit: "days" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "retention.dispatchedOutboxDays",
        value: 30,
        defaultValue: 30,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 7305, unit: "days" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "retention.coordinatorInvitationLinksDays",
        value: 1,
        defaultValue: 1,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 7305, unit: "days" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "retention.guardianInvitationLinksDays",
        value: 1,
        defaultValue: 1,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 7305, unit: "days" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "retention.coordinatorInvitationsDays",
        value: 90,
        defaultValue: 90,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 7305, unit: "days" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "retention.guardianInvitationsDays",
        value: 30,
        defaultValue: 30,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 7305, unit: "days" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "retention.contactMessagesMonths",
        value: 24,
        defaultValue: 24,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 240, unit: "months" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "retention.releasedLegalHoldsDays",
        value: 365,
        defaultValue: 365,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 1, max: 7305, unit: "days" },
        updatedAt: null,
        updatedBy: null,
      },
      {
        key: "retention.financialRecordsDays",
        value: 2922,
        defaultValue: 2922,
        source: "default",
        storedInvalid: false,
        input: { kind: "integer", min: 2922, max: 7305, unit: "days" },
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

  it("replaces a stored value that no longer fits, even with the default", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    // Stored before the setting's schema changed: 99 hours no longer fits,
    // so the default of 12 applies and the screen asks for a new value.
    await h.db.insert(setting).values({
      key: "auth.staffSessionHours",
      value: 99,
      updatedAt: h.clock.now(),
    });

    expect(
      await h
        .as(admin)
        .changeSetting({ key: "auth.staffSessionHours", value: 12 })
    ).toEqual({ ok: true, changed: true });

    const listed = await h.as(admin).listSettings();
    expect(
      listed.find((each) => each.key === "auth.staffSessionHours")
    ).toMatchObject({ value: 12, source: "stored", storedInvalid: false });
    const audit = await h.as(admin).searchAuditLog({ entityType: "setting" });
    expect(audit).toMatchObject({
      ok: true,
      entries: [
        {
          action: "setting.changed",
          entity: { type: "setting", id: "auth.staffSessionHours" },
          before: { value: 12, source: "default" },
          after: { value: 12 },
        },
      ],
    });
    expect(audit.ok && audit.entries).toHaveLength(1);
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

describe("the SMS settings", () => {
  const PHONE = "+91 98765 43210";

  it("switch #58's sign-in by text on and off at once", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const visitor = h.visitor({ ip: "203.0.113.77" });

    await h.as(admin).changeSetting({ key: "sms.enabled", value: true });

    expect(await h.as(visitor).signInMethods()).toEqual({
      email: true,
      phone: true,
    });
    expect(await h.as(visitor).requestPhoneCode({ phone: PHONE })).toEqual({
      ok: true,
    });
    expect(h.sms.codeFor(PHONE)).toMatch(/^\d{6}$/);

    await h.as(admin).changeSetting({ key: "sms.enabled", value: false });

    expect(await h.as(visitor).signInMethods()).toEqual({
      email: true,
      phone: false,
    });
    expect(await h.as(visitor).requestPhoneCode({ phone: PHONE })).toEqual({
      ok: false,
      error: "sms_disabled",
    });
  });

  it("set #58's ceiling on sign-in texts at once", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    await h.as(admin).changeSetting({ key: "sms.enabled", value: true });

    await h.as(admin).changeSetting({ key: "sms.maxPerHour", value: 1 });

    const from = (n: number) => h.as(h.visitor({ ip: `198.51.100.${n}` }));
    expect(await from(1).requestPhoneCode({ phone: PHONE })).toEqual({
      ok: true,
    });
    expect(
      await from(2).requestPhoneCode({ phone: "+91 98765 43211" })
    ).toMatchObject({ ok: false, error: "rate_limited" });
    expect(h.sms.sent).toHaveLength(1);
  });
});
