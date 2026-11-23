import { describe, expect, it } from "vitest";

import { createHarness, type Harness } from "@/test/harness";

async function seedStaff(h: Harness, role: "staff_admin" | "finance") {
  const member = await h.seed.member();
  await h.seed.grant(member, { role, scope: { type: "global" } });
  return member;
}

describe("getInventory", () => {
  it("lets a staff admin read field metadata without returning stored values", async () => {
    const h = await createHarness();
    const staff = await seedStaff(h, "staff_admin");
    const actor = await h.signIn(staff);
    h.clock.advance({ minutes: 11 });
    const { entries } = await h.as(actor).getInventory();

    expect(
      entries.find(
        ({ table, column }) => table === "contact_note" && column === "body"
      )
    ).toMatchObject({
      category: "content",
      purpose: "What staff noted while handling the message",
      subject: { kind: "contact_sender", via: "message_id" },
      retention: { policy: "contactMessages", toConfirm: true },
    });
    expect(
      entries.find(
        ({ table, column }) => table === "user" && column === "email"
      )
    ).toMatchObject({ subject: { kind: "user", via: "id" } });
    expect(JSON.stringify(entries)).not.toContain(staff.email);
  });

  it("lets a super admin read the inventory", async () => {
    const h = await createHarness();
    const admin = await h.signIn(await h.seed.superAdmin());
    const { entries } = await h.as(admin).getInventory();

    expect(entries.length).toBeGreaterThan(0);
  });

  it("refuses finance, a member and a visitor", async () => {
    const h = await createHarness();
    const finance = await h.signIn(await seedStaff(h, "finance"));
    h.cookies.clear();
    const member = await h.signIn(await h.seed.member());

    for (const actor of [finance, member, h.visitor()]) {
      await expect(h.as(actor).getInventory()).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });

  it("requires the staff admin's second factor", async () => {
    const h = await createHarness();
    const staff = await seedStaff(h, "staff_admin");
    await h.seed.authenticator(staff);
    const actor = await h.signIn(staff, undefined, {
      secondFactor: false,
    });

    await expect(h.as(actor).getInventory()).rejects.toMatchObject({
      code: "second_factor_required",
    });
  });
});
