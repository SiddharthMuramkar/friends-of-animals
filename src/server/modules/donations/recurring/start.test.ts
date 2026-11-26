import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { openDonations, teenWithLogin } from "../testing";

const input = {
  amountMinor: 100_000n,
  showOnWall: false,
  declaredAdult: true,
  declaredIndianSource: true,
};

describe("startRecurringDonation", () => {
  it("starts an adult's mandate and reuses a plan for the same amount", async () => {
    const h = await createHarness();
    await openDonations(h);
    await h.settings.set("donations.recurringEnabled", true);
    const member = await h.signIn(await h.seed.member());
    const first = await h.as(member).startRecurringDonation(input);
    const second = await h.as(member).startRecurringDonation(input);
    expect(first).toMatchObject({ ok: true, status: "pending_authorisation" });
    expect(second).toMatchObject({ ok: true, status: "pending_authorisation" });
    expect(h.gateway.plans).toHaveLength(1);
    expect(h.gateway.subscriptions).toHaveLength(2);
    expect(await h.as(member).listMyRecurringDonations()).toHaveLength(2);
  });
  it("refuses guests and minors", async () => {
    const h = await createHarness();
    await openDonations(h);
    await h.settings.set("donations.recurringEnabled", true);
    expect(await h.as(h.visitor()).startRecurringDonation(input)).toEqual({
      ok: false,
      error: "sign_in_required",
    });
    const { teen } = await teenWithLogin(h);
    expect(await h.as(teen).startRecurringDonation(input)).toEqual({
      ok: false,
      error: "minor_must_ask_guardian",
    });
    expect(h.gateway.plans).toHaveLength(0);
  });
  it("refuses amounts outside the monthly bounds before requesting a plan", async () => {
    const h = await createHarness();
    await openDonations(h);
    await h.settings.set("donations.recurringEnabled", true);
    const actor = await h.signIn(await h.seed.member());
    expect(
      await h
        .as(actor)
        .startRecurringDonation({ ...input, amountMinor: 9_999n })
    ).toEqual({ ok: false, error: "amount_too_small" });
    expect(
      await h
        .as(actor)
        .startRecurringDonation({ ...input, amountMinor: 1_500_001n })
    ).toEqual({ ok: false, error: "amount_too_large" });
    expect(h.gateway.plans).toHaveLength(0);
  });
});
