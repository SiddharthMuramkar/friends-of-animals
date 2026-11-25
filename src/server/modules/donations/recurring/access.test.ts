import { describe, expect, it } from "vitest";
import { createApp } from "@/server/app";
import { DomainError } from "@/server/errors";
import { createHarness } from "@/test/harness";
import { fallbackPaymentGateway } from "@/server/ports/payment-gateway-fallback";
import { setup } from "./testing";
import { openDonations } from "../testing";
describe("recurring authorisation and access", () => {
  it("only exposes a mandate to its owner and the register to finance", async () => {
    const { h, actor, id } = await setup();
    const account = await h.seed.member();
    const other = await h.signIn(account);
    await expect(h.as(h.visitor()).listMyRecurringDonations()).rejects.toThrow(
      DomainError
    );
    await expect(h.as(other).listRecurringDonations()).rejects.toThrow(
      DomainError
    );
    expect(await h.as(other).getMyRecurringDonation({ id })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await h.as(actor).getMyRecurringDonation({ id })).toMatchObject({
      ok: true,
    });
    await h.seed.grant(account, { role: "finance", scope: { type: "global" } });
    const finance = await h.signIn(account);
    expect(await h.as(finance).listRecurringDonations()).toHaveLength(1);
    expect(await h.as(finance).cancelRecurringDonation({ id })).toMatchObject({
      ok: true,
      status: "cancelled",
    });
  });
  it("simulates an authorised first charge only on non-production fallback", async () => {
    const h = await createHarness();
    await openDonations(h);
    await h.settings.set("donations.recurringEnabled", true);
    const gateway = fallbackPaymentGateway({
      db: h.db,
      clock: h.clock,
      appEnv: "local",
    });
    const actor = await h.signIn(await h.seed.member());
    const other = await h.signIn(await h.seed.member());
    const app = createApp({ ...h.deps, payments: gateway });
    const started = await app
      .as(actor)
      .startRecurringDonation({
        amountMinor: 100_000n,
        showOnWall: false,
        declaredAdult: true,
        declaredIndianSource: true,
      });
    if (!started.ok) throw new Error("Not started");
    const id = started.id;
    expect(await app.as(other).payRecurringTestCheckout({ id })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await app.as(actor).payRecurringTestCheckout({ id })).toEqual({
      ok: true,
      status: "active",
    });
    expect(await app.as(actor).getMyRecurringDonation({ id })).toMatchObject({
      ok: true,
      charges: [{ receiptNumber: "FOA-RCPT-2627-000001" }],
    });
    expect(await app.as(actor).payRecurringTestCheckout({ id })).toEqual({
      ok: false,
      error: "not_pending",
    });
  });
});
