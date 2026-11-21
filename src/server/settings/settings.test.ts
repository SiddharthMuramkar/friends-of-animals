// Seam 1 for runtime settings (#62): the typed accessor and the settings
// use cases, on PGlite with the real migrations.

import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { createHarness, type Harness } from "@/test/harness";

import { readSetting } from "./index";

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
