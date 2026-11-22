import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { createApp, type App } from "@/server/app";
import { DomainError } from "@/server/errors";
import { fallbackPaymentGateway } from "@/server/ports/payment-gateway-fallback";
import { createHarness } from "@/test/harness";

import { registrationsOf, schoolWithStudents, type School } from "./testing";

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

/** Opens the school's order through `app`, as its coordinator. */
async function openOrder(app: App, school: School) {
  const result = await app
    .as(school.coordinator.actor)
    .payInstitutionFees(school.ids);
  if (!result.ok || result.kind !== "checkout") {
    throw new Error(`No order: ${JSON.stringify(result)}`);
  }
  return { batchId: result.batchId, orderId: result.checkout.orderId };
}

function answer(
  app: App,
  school: School,
  batchId: string,
  outcome: "pay" | "decline",
  actor: Actor = school.coordinator.actor
) {
  return app
    .as(actor)
    .payTestCheckout({ institutionId: school.institutionId, batchId, outcome });
}

describe("payTestCheckout", () => {
  it("pays the batch's own order, and what it hands back confirms the batch", async () => {
    const { h, gateway, app } = await fallbackWorld();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(app, school);

    const paid = await answer(app, school, batchId, "pay");

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
      await app.as(school.coordinator.actor).confirmCheckout({
        institutionId: school.institutionId,
        batchId,
        paymentId: paid.paymentId,
        signature: paid.signature,
      })
    ).toEqual({ ok: true, outcome: "captured" });
    expect(
      (await registrationsOf(h, school.registrationIds)).map((r) => r.status)
    ).toEqual(["confirmed", "confirmed"]);
  });

  it("declines: a failed attempt on the batch's order, with nothing to sign", async () => {
    const { h, gateway, app } = await fallbackWorld();
    const school = await schoolWithStudents(h);
    const { batchId, orderId } = await openOrder(app, school);

    expect(await answer(app, school, batchId, "decline")).toEqual({
      ok: true,
      outcome: "declined",
    });
    expect(await gateway.fetchOrderPayments(orderId)).toMatchObject([
      { orderId, status: "failed" },
    ]);
  });

  it("lets the authorised person pay, and refuses another institution's coordinator and a plain member, who touch nothing", async () => {
    const { h, gateway, app } = await fallbackWorld();
    const school = await schoolWithStudents(h);
    const other = await schoolWithStudents(h, {
      name: "Other School",
      code: "OTHR27",
      students: 0,
    });
    const member = await h.signIn(await h.seed.member());
    const { batchId, orderId } = await openOrder(app, school);

    await expect(
      answer(app, school, batchId, "pay", other.coordinator.actor)
    ).rejects.toThrow(DomainError);
    await expect(answer(app, school, batchId, "pay", member)).rejects.toThrow(
      DomainError
    );
    expect(await gateway.fetchOrderPayments(orderId)).toEqual([]);

    expect(
      await answer(app, school, batchId, "pay", await h.signIn(school.admin))
    ).toMatchObject({ ok: true, outcome: "paid" });
  });

  it("finds no batch of another institution, so nobody pays another school's order through their own", async () => {
    const { h, gateway, app } = await fallbackWorld();
    const school = await schoolWithStudents(h);
    const other = await schoolWithStudents(h, {
      name: "Other School",
      code: "OTHR27",
      students: 1,
    });
    const theirs = await openOrder(app, other);

    expect(
      await answer(app, school, theirs.batchId, "pay", school.coordinator.actor)
    ).toEqual({ ok: false, error: "not_found" });
    expect(await gateway.fetchOrderPayments(theirs.orderId)).toEqual([]);
  });

  it("pays the order stored with the batch, never one the browser names", async () => {
    const { h, gateway, app } = await fallbackWorld();
    const school = await schoolWithStudents(h);
    const other = await schoolWithStudents(h, {
      name: "Other School",
      code: "OTHR27",
      students: 1,
    });
    const mine = await openOrder(app, school);
    const theirs = await openOrder(app, other);
    const posted = {
      institutionId: school.institutionId,
      batchId: mine.batchId,
      outcome: "pay" as const,
      orderId: theirs.orderId,
    };

    await app.as(school.coordinator.actor).payTestCheckout(posted);

    expect(await gateway.fetchOrderPayments(theirs.orderId)).toEqual([]);
    expect(await gateway.fetchOrderPayments(mine.orderId)).toHaveLength(1);
  });

  it("takes only pay or decline", async () => {
    const { h, gateway, app } = await fallbackWorld();
    const school = await schoolWithStudents(h);
    const { batchId, orderId } = await openOrder(app, school);
    const posted = {
      institutionId: school.institutionId,
      batchId,
      outcome: "refund" as "pay",
    };

    expect(
      await app.as(school.coordinator.actor).payTestCheckout(posted)
    ).toMatchObject({ ok: false, error: "invalid_input" });
    expect(await gateway.fetchOrderPayments(orderId)).toEqual([]);
  });

  it("pays nothing once the batch is paid", async () => {
    const { h, gateway, app } = await fallbackWorld();
    const school = await schoolWithStudents(h);
    const { batchId, orderId } = await openOrder(app, school);
    const paid = await answer(app, school, batchId, "pay");
    if (!paid.ok || paid.outcome !== "paid") throw new Error("Not paid");
    await app.as(school.coordinator.actor).confirmCheckout({
      institutionId: school.institutionId,
      batchId,
      paymentId: paid.paymentId,
      signature: paid.signature,
    });

    expect(await answer(app, school, batchId, "pay")).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await gateway.fetchOrderPayments(orderId)).toHaveLength(1);
  });

  it("is off wherever the fallback isn't the gateway", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const fake = createApp(h.deps);
    const { batchId, orderId } = await openOrder(fake, school);

    expect(await answer(fake, school, batchId, "pay")).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(await h.gateway.fetchOrderPayments(orderId)).toEqual([]);
  });
});
