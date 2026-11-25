import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";

import {
  capturedDonation,
  openDonations,
  openedOrder,
  startedDonation,
} from "./testing";

async function withRole(
  h: Harness,
  role: "finance" | "content_manager" | "competition_manager" | "super_admin",
  email: string
) {
  const account = await h.seed.member({ email });
  await h.seed.grant(account, { role, scope: { type: "global" } });
  return h.signIn(account);
}

describe("listDonations and getDonation", () => {
  it("shows finance every donation with its donor and receipt, newest first", async () => {
    const h = await createHarness();
    await openDonations(h);
    const first = await capturedDonation(h);
    h.clock.advance({ minutes: 5 });
    const second = await startedDonation(h, {
      donorType: "csr",
      name: "Ravi Kumar",
      email: "ravi@example.test",
      organisationName: "Acme Foundation",
      discloseOrganisation: false,
      amountMinor: 250_000n,
    });
    const finance = await withRole(h, "finance", "finance@example.test");

    const listed = await h.as(finance).listDonations({});
    expect(listed).toEqual({
      ok: true,
      limited: false,
      donations: [
        {
          id: second.donationId,
          createdAt: expect.any(Date),
          amountMinor: 250_000n,
          status: "pending",
          donorType: "csr",
          donorName: "Ravi Kumar",
          organisationName: "Acme Foundation",
          receiptNumber: null,
          guest: true,
        },
        expect.objectContaining({
          id: first.donationId,
          status: "captured",
          donorName: "Asha Rao",
          receiptNumber: "FOA-RCPT-2627-000001",
        }),
      ],
    });
    expect(
      await h.as(finance).getDonation({ donationId: first.donationId })
    ).toMatchObject({
      ok: true,
      donation: {
        donorEmail: "asha@example.test",
        receipt: { number: "FOA-RCPT-2627-000001", cancelledAt: null },
        payment: { status: "captured", gatewayPaymentId: first.paymentId },
        refunds: [],
        canRequestRefund: true,
      },
    });
  });

  it("filters by status, donor type and IST dates", async () => {
    const h = await createHarness();
    await openDonations(h);
    await capturedDonation(h);
    await startedDonation(h, { email: "ravi@example.test" });
    const finance = await withRole(h, "finance", "finance@example.test");

    const captured = await h.as(finance).listDonations({ status: "captured" });
    expect(captured.ok && captured.donations.map((d) => d.status)).toEqual([
      "captured",
    ]);
    const corporate = await h
      .as(finance)
      .listDonations({ donorType: "corporate" });
    expect(corporate.ok && corporate.donations).toEqual([]);
    const today = await h
      .as(finance)
      .listDonations({ from: "2027-01-15", to: "2027-01-15" });
    expect(today.ok && today.donations).toHaveLength(2);
    expect(
      await h
        .as(finance)
        .listDonations({ from: "2027-01-16", to: "2027-01-15" })
    ).toEqual({ ok: false, error: "range_reversed" });
  });

  it("refuses everyone but finance, super admin included", async () => {
    const h = await createHarness();
    await openDonations(h);
    const { donationId } = await capturedDonation(h);

    for (const actor of [
      await withRole(h, "content_manager", "cms@example.test"),
      await withRole(h, "competition_manager", "cm@example.test"),
      await withRole(h, "super_admin", "sa@example.test"),
      await h.signIn(await h.seed.member()),
      h.visitor(),
    ]) {
      await expect(h.as(actor).listDonations({})).rejects.toThrow(DomainError);
      await expect(h.as(actor).getDonation({ donationId })).rejects.toThrow(
        DomainError
      );
    }
  });
});

describe("getDonationOutcome", () => {
  it("says a donation is captured, with its receipt number", async () => {
    const h = await createHarness();
    await openDonations(h);
    const { donationId, checkoutToken } = await capturedDonation(h);

    expect(
      await h.as(h.visitor()).getDonationOutcome({ donationId, checkoutToken })
    ).toEqual({
      ok: true,
      outcome: {
        status: "captured",
        amountMinor: 50_000n,
        receiptNumber: "FOA-RCPT-2627-000001",
        receiptCancelled: false,
        foreignRefund: false,
      },
    });
  });

  it("asks the gateway once about a donation still waiting, so the page is right before any webhook", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);
    const orderId = await openedOrder(h, started);

    expect(await h.as(h.visitor()).getDonationOutcome(started)).toMatchObject({
      ok: true,
      outcome: { status: "pending" },
    });
    h.gateway.capture(orderId);
    expect(await h.as(h.visitor()).getDonationOutcome(started)).toMatchObject({
      ok: true,
      outcome: { status: "captured", receiptNumber: "FOA-RCPT-2627-000001" },
    });
  });

  it("still answers when the gateway can't", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);
    await openedOrder(h, started);
    h.gateway.failNextFetch();

    expect(await h.as(h.visitor()).getDonationOutcome(started)).toMatchObject({
      ok: true,
      outcome: { status: "pending" },
    });
    expect(h.errors.reported).toHaveLength(1);
  });

  it("lets a signed-in member who holds the token read it too, and the platform not at all", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);
    const member = await h.signIn(await h.seed.member());

    expect((await h.as(member).getDonationOutcome(started)).ok).toBe(true);
    await expect(
      h.as({ kind: "system", process: "worker" }).getDonationOutcome(started)
    ).rejects.toThrow(DomainError);
  });
});
