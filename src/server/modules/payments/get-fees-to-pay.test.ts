import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { createHarness } from "@/test/harness";

import { FEE_PAISE, openOrder, schoolWithStudents } from "./testing";

describe("getFeesToPay", () => {
  it("shows the coordinator how many students wait for their fee, the fee each and the total", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 3 });

    const result = await h
      .as(school.coordinator.actor)
      .getFeesToPay(school.ids);

    expect(result).toEqual({
      ok: true,
      fees: {
        reference: school.reference,
        institution: { name: expect.any(String) },
        competition: { code: "PAWS27", name: "Paws on the Pavement" },
        students: 3,
        fee: { amountMinor: FEE_PAISE, currency: "INR" },
        total: { amountMinor: 3n * FEE_PAISE, currency: "INR" },
        lastPaidBatchId: null,
      },
    });
  });

  it("has nothing left to pay once the batch is captured, and names that batch", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 2 });
    const { batchId, orderId } = await openOrder(school);
    const paid = h.gateway.capture(orderId);
    await h.as(school.coordinator.actor).confirmCheckout({
      institutionId: school.institutionId,
      batchId,
      ...paid,
    });

    const result = await h
      .as(school.coordinator.actor)
      .getFeesToPay(school.ids);

    expect(result).toMatchObject({
      ok: true,
      fees: {
        students: 0,
        total: { amountMinor: 0n, currency: "INR" },
        lastPaidBatchId: batchId,
      },
    });
  });

  it("says when the institution fee isn't set yet", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { feePaise: null });

    expect(
      await h.as(school.coordinator.actor).getFeesToPay(school.ids)
    ).toMatchObject({
      ok: true,
      fees: { students: 2, fee: null, total: null },
    });
  });

  it("shows a free competition as nothing to pay for its students", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { feePaise: 0n });

    expect(
      await h.as(school.coordinator.actor).getFeesToPay(school.ids)
    ).toMatchObject({
      ok: true,
      fees: {
        students: 2,
        fee: { amountMinor: 0n, currency: "INR" },
        total: { amountMinor: 0n, currency: "INR" },
      },
    });
  });

  it("lets the institution's authorised person read it, and refuses another institution's coordinator and a plain member", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const other = await schoolWithStudents(h, {
      name: "Other School",
      code: "OTHR27",
      students: 0,
    });
    const member = await h.signIn(await h.seed.member());
    const admin = await h.signIn(school.admin);

    expect(await h.as(admin).getFeesToPay(school.ids)).toMatchObject({
      ok: true,
    });
    await expect(
      h.as(other.coordinator.actor).getFeesToPay(school.ids)
    ).rejects.toThrow(DomainError);
    await expect(h.as(member).getFeesToPay(school.ids)).rejects.toThrow(
      DomainError
    );
  });

  it("finds no registration of another institution under this one", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const other = await schoolWithStudents(h, {
      name: "Other School",
      code: "OTHR27",
      students: 1,
    });

    expect(
      await h.as(school.coordinator.actor).getFeesToPay({
        institutionId: school.institutionId,
        reference: other.reference,
      })
    ).toEqual({ ok: false, error: "not_found" });
  });
});
