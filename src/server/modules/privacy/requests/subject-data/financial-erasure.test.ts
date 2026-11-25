import { describe, expect, it } from "vitest";

import {
  donation,
  donor,
  erasureRecord,
  ledgerPosting,
  receipt,
  recurringDonation,
  refund,
  user,
} from "@/server/db/schema";
import {
  capturedDonation,
  donationForm,
  openDonations,
} from "@/server/modules/donations/testing";
import { twoFinanceUsers } from "@/server/modules/ledger/testing";
import { createHarness, type Harness } from "@/test/harness";
import { eq } from "drizzle-orm";
import { signedInOfficer, requestRows } from "../testing";
import { runExecuteErasure } from "./erasure";

const recurringForm = {
  amountMinor: 100_000n,
  showOnWall: true,
  declaredAdult: true,
  declaredIndianSource: true,
};

async function prepare() {
  const h = await createHarness();
  await h.settings.set("privacy.erasureEnabled", true);
  await h.settings.set("privacy.erasureKeepsPayerAccount", false);
  await openDonations(h);
  await h.settings.set("donations.recurringEnabled", true);
  const member = await h.seed.member({
    name: "Erased Donor",
    email: "donor@example.test",
  });
  const actor = await h.signIn(member);
  const gift = await capturedDonation(
    h,
    {
      name: member.name,
      email: member.email!,
      showOnWall: true,
      wallName: "Public Erased Donor",
    },
    actor
  );
  const company = await capturedDonation(
    h,
    {
      name: member.name,
      email: member.email!,
      donorType: "corporate",
      organisationName: "Erased Organisation",
      discloseOrganisation: true,
    },
    actor
  );
  const other = await capturedDonation(h, {
    name: "Other Donor",
    email: "other@example.test",
    showOnWall: true,
    wallName: "Other Donor",
  });
  const mandate = await h.as(actor).startRecurringDonation(recurringForm);
  if (!mandate.ok) throw new Error("Could not start mandate");
  const subscriptionId = mandate.checkout.subscriptionId;
  h.gateway.authoriseSubscription(subscriptionId);
  h.gateway.chargeSubscription(subscriptionId);
  const signal = () =>
    h.as(h.visitor()).receiveGatewayWebhook(
      h.gateway.webhook({
        type: "subscription.charged",
        orderId: null,
        subscriptionId,
      })
    );
  await signal();
  await h.drain();
  const pending = await h.as(actor).startRecurringDonation(recurringForm);
  if (!pending.ok) throw new Error("Could not start pending mandate");
  const filed = await h
    .as(actor)
    .submitPrivacyRequest({ type: "erasure", subject: { kind: "self" } });
  if (!filed.ok) throw new Error("Could not file erasure");
  const officer = await signedInOfficer(h);
  await h.as(officer.actor).startPrivacyRequest({ id: filed.requestId });
  await h.drain();
  return {
    h,
    actor,
    member,
    gift,
    company,
    other,
    mandate,
    pending,
    subscriptionId,
    signal,
    filed,
    officer,
  };
}

async function approve({
  h,
  filed,
  officer,
}: Awaited<ReturnType<typeof prepare>>) {
  const preview = await h
    .as(officer.actor)
    .previewErasure({ id: filed.requestId });
  if (!preview.ok) throw new Error("Could not preview erasure");
  expect(
    await h.as(officer.actor).executeErasure({
      id: filed.requestId,
      fingerprint: preview.preview.plan.fingerprint,
    })
  ).toEqual({ ok: true });
  return preview.preview.plan;
}

async function lockMonth(h: Harness) {
  const finance = await twoFinanceUsers(h);
  const requested = await h
    .as(finance.requester.actor)
    .requestPeriodLock({ month: "2027-01" });
  if (!requested.ok) throw new Error("Could not request lock");
  expect(
    await h
      .as(finance.approver.actor)
      .approveFinanceRequest({ requestId: requested.requestId })
  ).toEqual({ ok: true, status: "approved" });
}

describe("financial records during erasure", () => {
  it.each([
    { held: false, keepPayer: false },
    { held: false, keepPayer: true },
    { held: true, keepPayer: false },
  ])(
    "withdraws recognition, cancels mandates and keeps financial records ($held hold, $keepPayer payer retention)",
    async ({ held, keepPayer }) => {
      const setup = await prepare();
      const { h, member, subscriptionId, pending, filed } = setup;
      await h.settings.set("privacy.erasureKeepsPayerAccount", keepPayer);
      await lockMonth(h);
      const before = await h.as(h.visitor()).getTransparency();
      expect(before).toMatchObject({
        published: true,
        supporters: expect.arrayContaining([
          "Public Erased Donor",
          "Other Donor",
        ]),
        organisations: [{ name: "Erased Organisation", totalMinor: 50_000n }],
      });
      const receipts = await h.db.select().from(receipt);
      const postings = await h.db.select().from(ledgerPosting);
      if (held) {
        const admin = await h.signIn(await h.seed.superAdmin());
        expect(
          await h.as(admin).placeLegalHold({
            subjectType: "user",
            subjectId: member.id,
            reason: "Evidence preservation",
          })
        ).toMatchObject({ ok: true });
      }
      const plan = await approve(setup);
      await h.drain();
      expect(await h.gateway.fetchSubscription(subscriptionId)).toMatchObject({
        status: "cancelled",
      });
      expect(
        await h.gateway.fetchSubscription(pending.checkout.subscriptionId)
      ).toMatchObject({ status: "cancelled" });
      expect(await h.db.select().from(recurringDonation)).toMatchObject([
        { status: "cancelled", showOnWall: false, wallName: null },
        { status: "cancelled", showOnWall: false, wallName: null },
      ]);
      expect(await h.db.select().from(receipt)).toEqual(receipts);
      expect(await h.db.select().from(ledgerPosting)).toEqual(postings);
      expect(
        await h.db.select().from(user).where(eq(user.id, member.id))
      ).toHaveLength(held || keepPayer ? 1 : 0);
      expect((await requestRows(h))[0]).toMatchObject({
        status: "partially_completed",
      });
      expect(await h.as(h.visitor()).getTransparency()).toMatchObject({
        published: true,
        supporters: ["Other Donor"],
        organisations: [],
        donationsMinor: 250_000n,
      });
      expect(plan.categories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "recurring_mandates",
            action: "withdraw",
            count: 2,
          }),
          expect.objectContaining({
            key: "donor_recognition",
            action: "withdraw",
          }),
          expect.objectContaining({
            key: "donation_records",
            action: "retain",
          }),
        ])
      );
      const records = await h.db.select().from(erasureRecord);
      await runExecuteErasure(h.deps, { requestId: filed.requestId });
      expect(await h.db.select().from(erasureRecord)).toEqual(records);
      expect(h.gateway.cancelCalls).toHaveLength(2);
      h.clock.advance({ days: 31 });
      h.gateway.runCycle();
      expect(
        await h.gateway.fetchSubscriptionCharges(subscriptionId)
      ).toHaveLength(1);
    }
  );

  it("refuses a new gift or mandate while the approved erasure is running", async () => {
    const setup = await prepare();
    const { h, actor, filed } = setup;
    await approve(setup);
    expect(
      await h.as(actor).startRecurringDonation(recurringForm)
    ).toMatchObject({ ok: false, error: "donations_closed" });
    expect(await h.as(actor).startDonation(donationForm())).toMatchObject({
      ok: false,
      error: "donations_closed",
    });
    expect(h.gateway.subscriptions).toHaveLength(2);
    await h.drain();
    expect((await requestRows(h))[0]).toMatchObject({
      status: "partially_completed",
    });
    await runExecuteErasure(h.deps, { requestId: filed.requestId });
  });

  it("leaves the request open and the account intact until cancellation is confirmed; refunds a charge racing the cancellation", async () => {
    const setup = await prepare();
    const { h, member, subscriptionId, filed, signal, mandate } = setup;
    await approve(setup);
    h.clock.advance({ seconds: 5 });
    h.gateway.refuseNextCancel();
    await expect(
      runExecuteErasure(h.deps, { requestId: filed.requestId })
    ).rejects.toThrow();
    expect((await requestRows(h))[0]).toMatchObject({
      status: "in_progress",
      closedAt: null,
    });
    expect(
      await h.db.select().from(user).where(eq(user.id, member.id))
    ).toHaveLength(1);
    expect(
      await h.db
        .select()
        .from(recurringDonation)
        .where(eq(recurringDonation.id, mandate.id))
    ).toMatchObject([
      { status: "active", cancelRequestedAt: expect.any(Date) },
    ]);
    // The user still exists and can see their cancellation pending. All
    // optional disclosure has already been withdrawn, regardless of outage.
    expect(
      await h.as(setup.actor).getMyRecurringDonation({ id: mandate.id })
    ).toMatchObject({
      ok: true,
      recurring: { cancelRequestedAt: expect.any(Date), showOnWall: false },
    });
    expect(
      await h.db
        .select()
        .from(donation)
        .where(eq(donation.id, setup.gift.donationId))
    ).toMatchObject([{ showOnWall: false, wallName: null }]);
    h.gateway.chargeSubscription(subscriptionId);
    await signal();
    await h.drain();
    expect(await h.db.select().from(donation)).toHaveLength(4);
    expect(await h.db.select().from(receipt)).toHaveLength(4);
    expect(await h.db.select().from(refund)).toMatchObject([
      { kind: "recurring_after_cancel", status: "refunded" },
    ]);
    expect(await h.gateway.fetchSubscription(subscriptionId)).toMatchObject({
      status: "cancelled",
    });
    expect((await requestRows(h))[0]).toMatchObject({
      status: "partially_completed",
    });
    expect(
      await h.db.select().from(user).where(eq(user.id, member.id))
    ).toHaveLength(0);
    expect(
      await h.db
        .select()
        .from(donor)
        .where(
          eq(
            donor.id,
            (
              await h.db
                .select()
                .from(recurringDonation)
                .where(eq(recurringDonation.id, mandate.id))
            )[0]!.donorId
          )
        )
    ).toHaveLength(1);
  });
});
