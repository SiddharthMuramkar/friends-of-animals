import { asc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, receipt } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness } from "@/test/harness";

import {
  capturedDonation,
  openDonations,
  openedOrder,
  receiptTokenSentTo,
  startedDonation,
} from "./testing";

const WORKER = { kind: "system", process: "worker" } as const;

describe("who may use a donation's checkout", () => {
  it("is whoever holds its token, never the platform's own processes", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);
    const orderId = await openedOrder(h, started);
    const paid = h.gateway.capture(orderId);

    await expect(h.as(WORKER).payForDonation(started)).rejects.toThrow(
      DomainError
    );
    await expect(
      h.as(WORKER).confirmDonationCheckout({ ...started, ...paid })
    ).rejects.toThrow(DomainError);
    await expect(
      h.as(WORKER).payDonationTestCheckout({ ...started, outcome: "pay" })
    ).rejects.toThrow(DomainError);
  });

  it("offers the test checkout only where the fallback gateway is the gateway", async () => {
    const h = await createHarness();
    await openDonations(h);
    const started = await startedDonation(h);

    expect(
      await h
        .as(h.visitor())
        .payDonationTestCheckout({ ...started, outcome: "pay" })
    ).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("getDonationTerms", () => {
  it("tells anyone whether giving is open and what it allows", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());

    expect(await h.as(h.visitor()).getDonationTerms()).toEqual({
      open: false,
      guestsAllowed: true,
      minAmountMinor: 10_000n,
      maxAmountMinor: 10_000_000n,
    });
    await openDonations(h);
    expect(await h.as(member).getDonationTerms()).toMatchObject({
      open: true,
    });
    await expect(h.as(WORKER).getDonationTerms()).rejects.toThrow(DomainError);
  });
});

describe("getReceiptByToken", () => {
  it("opens for anyone with the link, signed in or not, and never for the platform", async () => {
    const h = await createHarness();
    await openDonations(h);
    await capturedDonation(h);
    const token = receiptTokenSentTo(h, "asha@example.test");
    const member = await h.signIn(await h.seed.member());

    expect((await h.as(member).getReceiptByToken({ token })).ok).toBe(true);
    await expect(h.as(WORKER).getReceiptByToken({ token })).rejects.toThrow(
      DomainError
    );
  });
});

describe("the audit log of a donation", () => {
  it("records it started, captured, its receipt issued, and expiry, without the donor's details", async () => {
    const h = await createHarness();
    await openDonations(h);
    const { donationId } = await capturedDonation(h);
    const expiring = await startedDonation(h, { email: "ravi@example.test" });
    h.clock.advance({ hours: 25 });
    await h.as(WORKER).expirePendingDonations();
    const [issued] = await h.db.select().from(receipt);

    const rows = await h.db
      .select({ action: auditLog.action, entityId: auditLog.entityId })
      .from(auditLog)
      .where(
        inArray(auditLog.entityId, [
          donationId,
          expiring.donationId,
          issued!.id,
        ])
      )
      .orderBy(asc(auditLog.occurredAt), asc(auditLog.id));
    expect(rows).toEqual([
      { action: "donation.started", entityId: donationId },
      { action: "donation.captured", entityId: donationId },
      { action: "receipt.issued", entityId: issued!.id },
      { action: "donation.started", entityId: expiring.donationId },
      { action: "donation.expired", entityId: expiring.donationId },
    ]);
    const all = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityType, "donation"));
    expect(JSON.stringify(all)).not.toMatch(/Asha|asha@|Ravi|ravi@/);
  });
});
