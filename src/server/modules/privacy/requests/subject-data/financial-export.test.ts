import { describe, expect, it } from "vitest";

import { receiptLink } from "@/server/db/schema";
import { createHarness } from "@/test/harness";
import {
  capturedDonation,
  openDonations,
} from "@/server/modules/donations/testing";
import { signedInOfficer } from "../testing";
import { readZip } from "./read-zip";

const recurringForm = {
  amountMinor: 100_000n,
  showOnWall: true,
  declaredAdult: true,
  declaredIndianSource: true,
  pan: "ABCDE1234F",
};

describe("donor data in access exports", () => {
  it("exports own gifts, donor identity, PAN, receipts and mandate but no unrelated gifts or credentials", async () => {
    const h = await createHarness();
    await openDonations(h);
    await h.settings.set("donations.recurringEnabled", true);
    await h.settings.set("org.has80G", true);
    const member = await h.seed.member({
      name: "Asha Rao",
      email: "asha@example.test",
    });
    const actor = await h.signIn(member);
    const gift = await capturedDonation(
      h,
      {
        name: "Asha Rao",
        email: "asha@example.test",
        pan: recurringForm.pan,
      },
      actor
    );
    const mandate = await h.as(actor).startRecurringDonation(recurringForm);
    if (!mandate.ok) throw new Error("Could not start mandate");
    const subscriptionId = mandate.checkout.subscriptionId;
    h.gateway.authoriseSubscription(subscriptionId);
    h.gateway.chargeSubscription(subscriptionId);
    await h.as(h.visitor()).receiveGatewayWebhook(
      h.gateway.webhook({
        type: "subscription.charged",
        orderId: null,
        subscriptionId,
      })
    );
    await h.drain();
    const guest = await capturedDonation(h, {
      name: "Private unrelated donor",
      email: "asha@example.test",
      pan: "ZXCVB9876N",
    });
    const bearerTokens = h.email.sent.flatMap((mail) =>
      [...mail.text.matchAll(/\/receipts\/([A-Za-z0-9_-]{43})/g)].map(
        (match) => match[1]!
      )
    );
    expect(bearerTokens.length).toBeGreaterThan(0);
    const linkHashes = (
      await h.db.select({ tokenHash: receiptLink.tokenHash }).from(receiptLink)
    ).map(({ tokenHash }) => tokenHash);
    const access = await h
      .as(actor)
      .submitPrivacyRequest({ type: "access", subject: { kind: "self" } });
    if (!access.ok) throw new Error("Could not file access request");
    const officer = await signedInOfficer(h);
    await h.as(officer.actor).startPrivacyRequest({ id: access.requestId });
    expect(
      await h.as(officer.actor).buildSubjectExport({ id: access.requestId })
    ).toEqual({ ok: true });
    await h.drain();
    const link = await h
      .as(actor)
      .getPrivacyExportLink({ id: access.requestId });
    if (!link.ok) throw new Error("Could not download export");
    const stored = await h.storage.get(link.url);
    if (!stored.ok) throw new Error(stored.error);
    const zip = readZip(stored.bytes);
    const data = JSON.parse(zip.text("data.json"));
    expect(data.sections.donor).toHaveLength(2);
    for (const row of data.sections.donor) {
      expect(row).toMatchObject({
        name: "Asha Rao",
        email: "asha@example.test",
        pan: recurringForm.pan,
      });
      expect(row).not.toHaveProperty("email_hash");
    }
    expect(data.sections.donation).toHaveLength(2);
    expect(data.sections.donation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: gift.donationId,
          amount_minor: "50000",
          status: "captured",
        }),
        expect.objectContaining({
          recurring_donation_id: mandate.id,
          amount_minor: "100000",
          status: "captured",
        }),
      ])
    );
    expect(data.sections.receipt).toHaveLength(2);
    for (const row of data.sections.receipt) {
      expect(row.snapshot).toMatchObject({
        donor: { name: "Asha Rao" },
        taxExemption: { donorPanMasked: "******234F" },
      });
    }
    expect(data.sections.recurring_donation).toEqual([
      expect.objectContaining({
        id: mandate.id,
        status: "active",
        amount_minor: "100000",
        show_on_wall: true,
      }),
    ]);
    const all = zip.allText();
    for (const secret of [
      ...bearerTokens,
      ...linkHashes,
      guest.donationId,
      "Private unrelated donor",
      "ZXCVB9876N",
      subscriptionId,
      gift.checkoutToken,
      "checkout_token_hash",
      "gateway_subscription_id",
      "gateway_plan_id",
      "receipt_link_token_hash",
    ]) {
      expect(all).not.toContain(secret);
    }
    expect(data.sections.receipt_link).toBeUndefined();
  });
});
