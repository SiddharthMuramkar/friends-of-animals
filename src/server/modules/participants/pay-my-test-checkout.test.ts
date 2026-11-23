import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { createApp, type App } from "@/server/app";
import { DomainError } from "@/server/errors";
import {
  childForm,
  consentCompetition,
} from "@/server/modules/consent/testing";
import { fallbackPaymentGateway } from "@/server/ports/payment-gateway-fallback";
import { createHarness, type Harness } from "@/test/harness";

import { adultForm, openToIndividuals, signInMember } from "./testing";

const REGISTRATION_NUMBER = /^[A-Z]{3,6}\d{2}-R-[0-9A-HJKMNP-TV-Z]{6}$/;

/** The app as local, CI and previews run it: paying through the fallback. */
async function fallbackWorld() {
  const h = await createHarness();
  const gateway = fallbackPaymentGateway({
    db: h.db,
    clock: h.clock,
    appEnv: "local",
  });
  return { h, gateway, app: createApp({ ...h.deps, payments: gateway }) };
}

/** A signed-in adult registered for an open competition, not yet paid. */
async function registered(h: Harness, app: App, name = "Ravi Kumar") {
  const competition = await openToIndividuals(h, { code: "NEIGH27" });
  const adult = await signInMember(h, { name });
  const result = await app
    .as(adult.actor)
    .registerAsIndividual(adultForm(competition, { fullName: name }));
  if (!result.ok) throw new Error(JSON.stringify(result));
  return { ...adult, registrationId: result.registrationId };
}

/** Opens the adult's order through `app`, as they do on the pay page. */
async function openOrder(
  app: App,
  adult: { actor: Actor; registrationId: string }
) {
  const result = await app
    .as(adult.actor)
    .payForMyRegistration({ registrationId: adult.registrationId });
  if (!result.ok || result.kind !== "checkout") {
    throw new Error(`No order: ${JSON.stringify(result)}`);
  }
  return { batchId: result.batchId, orderId: result.checkout.orderId };
}

function answer(
  app: App,
  adult: { actor: Actor; registrationId: string },
  outcome: "pay" | "decline",
  actor: Actor = adult.actor
) {
  return app
    .as(actor)
    .payMyTestCheckout({ registrationId: adult.registrationId, outcome });
}

describe("payMyTestCheckout", () => {
  it("leaves an existing minor's test order unpaid in staging", async () => {
    const { h, gateway, app } = await fallbackWorld();
    const competition = await consentCompetition(h);
    const family = await h.seed.guardian({
      children: [{ fullName: "Asha Rao", age: 15 }],
    });
    const actor = await h.signIn(family.account);
    const made = await app
      .as(actor)
      .registerAsIndividual(
        childForm(competition, family.childIds[0]!, { participation: true })
      );
    if (!made.ok) throw new Error("Registration fixture failed");
    const child = { actor, registrationId: made.registrationId };
    const { orderId } = await openOrder(app, child);
    const staging = createApp({
      ...h.deps,
      payments: gateway,
      appEnv: "staging",
    });

    const result = await answer(staging, child, "pay");

    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, error: "unavailable" });
    expect(await gateway.fetchOrderPayments(orderId)).toEqual([]);
  });

  it("pays the order of the batch holding the adult's registration, and what it hands back confirms it", async () => {
    const { h, gateway, app } = await fallbackWorld();
    const ravi = await registered(h, app);
    const { orderId } = await openOrder(app, ravi);

    const paid = await answer(app, ravi, "pay");

    expect(paid).toEqual({
      ok: true,
      outcome: "paid",
      paymentId: expect.stringMatching(/\S/),
      signature: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(await gateway.fetchOrderPayments(orderId)).toMatchObject([
      { orderId, status: "captured" },
    ]);
    if (!paid.ok || paid.outcome !== "paid") throw new Error("Not paid");
    expect(
      await app.as(ravi.actor).confirmMyPayment({
        registrationId: ravi.registrationId,
        paymentId: paid.paymentId,
        signature: paid.signature,
      })
    ).toEqual({ ok: true, outcome: "captured" });
    const [mine] = await app.as(ravi.actor).listMyRegistrations();
    expect(mine).toMatchObject({
      status: "confirmed",
      registrationNumber: expect.stringMatching(REGISTRATION_NUMBER),
    });
  });

  it("declines: a failed attempt on the order, with nothing to sign", async () => {
    const { h, gateway, app } = await fallbackWorld();
    const ravi = await registered(h, app);
    const { orderId } = await openOrder(app, ravi);

    expect(await answer(app, ravi, "decline")).toEqual({
      ok: true,
      outcome: "declined",
    });
    expect(await gateway.fetchOrderPayments(orderId)).toMatchObject([
      { orderId, status: "failed" },
    ]);
  });

  it("refuses anyone but the registration's owner, who touch nothing", async () => {
    const { h, gateway, app } = await fallbackWorld();
    const ravi = await registered(h, app);
    const other = await signInMember(h, { name: "Meena Shah" });
    const { orderId } = await openOrder(app, ravi);

    await expect(answer(app, ravi, "pay", other.actor)).rejects.toThrow(
      DomainError
    );
    await expect(answer(app, ravi, "pay", h.visitor())).rejects.toThrow(
      DomainError
    );
    expect(await gateway.fetchOrderPayments(orderId)).toEqual([]);
  });

  it("finds nothing to pay before an order is open, or once it is paid", async () => {
    const { h, gateway, app } = await fallbackWorld();
    const ravi = await registered(h, app);

    expect(await answer(app, ravi, "pay")).toEqual({
      ok: false,
      error: "not_found",
    });

    const { orderId } = await openOrder(app, ravi);
    const paid = await answer(app, ravi, "pay");
    if (!paid.ok || paid.outcome !== "paid") throw new Error("Not paid");
    await app.as(ravi.actor).confirmMyPayment({
      registrationId: ravi.registrationId,
      paymentId: paid.paymentId,
      signature: paid.signature,
    });

    expect(await answer(app, ravi, "pay")).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await gateway.fetchOrderPayments(orderId)).toHaveLength(1);
  });

  it("takes only pay or decline", async () => {
    const { h, gateway, app } = await fallbackWorld();
    const ravi = await registered(h, app);
    const { orderId } = await openOrder(app, ravi);

    expect(
      await app.as(ravi.actor).payMyTestCheckout({
        registrationId: ravi.registrationId,
        outcome: "refund" as "pay",
      })
    ).toMatchObject({ ok: false, error: "invalid_input" });
    expect(await gateway.fetchOrderPayments(orderId)).toEqual([]);
  });

  it("is off wherever the fallback isn't the gateway", async () => {
    const h = await createHarness();
    const fake = createApp(h.deps);
    const ravi = await registered(h, fake);
    const { orderId } = await openOrder(fake, ravi);

    expect(await answer(fake, ravi, "pay")).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(await h.gateway.fetchOrderPayments(orderId)).toEqual([]);
  });
});
