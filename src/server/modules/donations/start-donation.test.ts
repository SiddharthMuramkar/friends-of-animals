import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, donation, donor, paymentBatch } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";

import {
  donationForm,
  donationRow,
  openDonations,
  startedDonation,
  teenWithLogin,
} from "./testing";

async function counts(h: Harness) {
  return {
    donors: (await h.db.select().from(donor)).length,
    donations: (await h.db.select().from(donation)).length,
    batches: (await h.db.select().from(paymentBatch)).length,
  };
}

const NOTHING = { donors: 0, donations: 0, batches: 0 };

describe("startDonation", () => {
  it("lets a guest start a pending donation paid through a donation batch", async () => {
    const h = await createHarness();
    await openDonations(h);

    const result = await h.as(h.visitor()).startDonation(donationForm());

    expect(result).toEqual({
      ok: true,
      donationId: expect.any(String),
      checkoutToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    if (!result.ok) return;
    const row = await donationRow(h, result.donationId);
    expect(row).toMatchObject({
      status: "pending",
      origin: "online_checkout",
      amountMinor: 50_000n,
      showOnWall: false,
      wallName: null,
    });
    expect(row.checkoutTokenHash).not.toContain(result.checkoutToken);
    const [batch] = await h.db
      .select()
      .from(paymentBatch)
      .where(eq(paymentBatch.id, row.paymentBatchId!));
    expect(batch).toMatchObject({
      purpose: "donation",
      status: "created",
      amountMinor: 50_000n,
      competitionId: null,
      route: null,
      payerUserId: null,
    });
    // Nothing went to the gateway yet: the checkout page opens the order.
    expect(h.gateway.orders).toEqual([]);
  });

  it("keeps the donor's name and email out of plain text and the audit log", async () => {
    const h = await createHarness();
    await openDonations(h);

    const { donationId } = await startedDonation(h);

    const [giver] = await h.db.select().from(donor);
    expect(giver!.name).not.toContain("Asha");
    expect(giver!.email).not.toContain("asha@");
    const entries = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, donationId));
    expect(entries.map((entry) => entry.action)).toEqual(["donation.started"]);
    expect(JSON.stringify(entries)).not.toMatch(/Asha|asha@/);
  });

  it("links a signed-in member's donation to their account", async () => {
    const h = await createHarness();
    await openDonations(h);
    const member = await h.seed.member();
    const actor = await h.signIn(member);

    await startedDonation(h, {}, actor);

    const [giver] = await h.db.select().from(donor);
    expect(giver!.userId).toBe(member.id);
  });

  it("starts nothing while donations are off, as in production until HR-15", async () => {
    const h = await createHarness();

    expect(await h.as(h.visitor()).startDonation(donationForm())).toEqual({
      ok: false,
      error: "donations_closed",
    });
    expect(await counts(h)).toEqual(NOTHING);
  });

  it("refuses a guest while guests may not give, but not a member", async () => {
    const h = await createHarness();
    await openDonations(h);
    await h.settings.set("donations.allowGuest", false);

    expect(await h.as(h.visitor()).startDonation(donationForm())).toEqual({
      ok: false,
      error: "guests_not_allowed",
    });
    const member = await h.signIn(await h.seed.member());
    expect((await h.as(member).startDonation(donationForm())).ok).toBe(true);
  });

  describe("a signed-in minor", () => {
    it("is stopped and pointed to their guardian, and nothing is written", async () => {
      const h = await createHarness();
      await openDonations(h);
      const { teen } = await teenWithLogin(h);
      const before = await counts(h);

      expect(await h.as(teen).startDonation(donationForm())).toEqual({
        ok: false,
        error: "minor_must_ask_guardian",
      });
      expect(await counts(h)).toEqual(before);
    });

    it("may give once 18 on India's calendar, and their guardian may give now", async () => {
      const h = await createHarness();
      await openDonations(h);
      const { teen, guardian } = await teenWithLogin(h);

      expect((await h.as(guardian).startDonation(donationForm())).ok).toBe(
        true
      );
      h.clock.advance({ days: 3 });
      expect((await h.as(teen).startDonation(donationForm())).ok).toBe(true);
    });
  });

  it.each([
    ["below the smallest donation", 9_999n],
    ["above the largest donation", 10_000_001n],
  ])("refuses an amount %s", async (_, amountMinor) => {
    const h = await createHarness();
    await openDonations(h);

    expect(
      await h.as(h.visitor()).startDonation(donationForm({ amountMinor }))
    ).toEqual({
      ok: false,
      error: "amount_out_of_range",
      minAmountMinor: 10_000n,
      maxAmountMinor: 10_000_000n,
    });
    expect(await counts(h)).toEqual(NOTHING);
  });

  it("follows the amount settings a super admin changed", async () => {
    const h = await createHarness();
    await openDonations(h);
    await h.settings.set("donations.minAmountRupees", 1000);

    const result = await h.as(h.visitor()).startDonation(donationForm());

    expect(result).toMatchObject({
      ok: false,
      error: "amount_out_of_range",
      minAmountMinor: 100_000n,
    });
  });

  it.each([
    ["the adult declaration", { declaredAdult: false }],
    ["the Indian-source declaration", { declaredIndianSource: false }],
  ])("refuses a donation without %s", async (_, overrides) => {
    const h = await createHarness();
    await openDonations(h);

    expect(
      await h.as(h.visitor()).startDonation(donationForm(overrides))
    ).toEqual({ ok: false, error: "declaration_required" });
    expect(await counts(h)).toEqual(NOTHING);
  });

  it.each(["corporate", "csr"])(
    "asks a %s donor whether its name may be shown",
    async (donorType) => {
      const h = await createHarness();
      await openDonations(h);

      expect(
        await h
          .as(h.visitor())
          .startDonation(
            donationForm({ donorType, organisationName: "Acme Pvt Ltd" })
          )
      ).toEqual({ ok: false, error: "disclosure_required" });
      expect(
        await h
          .as(h.visitor())
          .startDonation(
            donationForm({ donorType, discloseOrganisation: true })
          )
      ).toEqual({
        ok: false,
        error: "invalid_input",
        fields: ["organisationName"],
      });
    }
  );

  it("keeps a CSR partner's choice and its name", async () => {
    const h = await createHarness();
    await openDonations(h);

    await startedDonation(h, {
      donorType: "csr",
      organisationName: "Acme Foundation",
      discloseOrganisation: true,
      showOnWall: true,
    });

    const [giver] = await h.db.select().from(donor);
    expect(giver).toMatchObject({
      type: "csr",
      organisationName: "Acme Foundation",
      discloseOrganisation: true,
    });
    const [row] = await h.db.select().from(donation);
    expect(row).toMatchObject({
      showOnWall: true,
      wallName: "Acme Foundation",
    });
  });

  it.each([
    ["a person's first name and last initial", {}, "Asha R."],
    [
      "the donor's own wall name",
      { wallName: "A friend of dogs" },
      "A friend of dogs",
    ],
    [
      "no name for an organisation that keeps it private",
      {
        donorType: "corporate",
        organisationName: "Acme Pvt Ltd",
        discloseOrganisation: false,
      },
      null,
    ],
  ] as const)("puts %s on the donor wall", async (_, overrides, wallName) => {
    const h = await createHarness();
    await openDonations(h);

    await startedDonation(h, { showOnWall: true, ...overrides });

    const [row] = await h.db.select().from(donation);
    expect(row).toMatchObject({ showOnWall: true, wallName });
  });

  it("checks the form's fields", async () => {
    const h = await createHarness();
    await openDonations(h);

    expect(
      await h
        .as(h.visitor())
        .startDonation(donationForm({ name: " ", email: "not-an-email" }))
    ).toEqual({ ok: false, error: "invalid_input", fields: ["name", "email"] });
  });

  it("refuses the platform's own processes", async () => {
    const h = await createHarness();
    await openDonations(h);

    await expect(
      h.as({ kind: "system", process: "worker" }).startDonation(donationForm())
    ).rejects.toThrow(DomainError);
  });
});
