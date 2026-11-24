import { expect, it, vi } from "vitest";

import { createApp } from "@/server/app";
import {
  childForm,
  consentCompetition,
} from "@/server/modules/consent/testing";
import { signInStaff } from "@/server/modules/payments/testing";
import { createHarness } from "@/test/harness";
import { renderHtml, visibleText } from "@/test/render";

import { ReviewCaseView } from "./review-case-view";

vi.mock("next-intl/server", () => import("@/test/next-intl-server"));

it("explains why finance cannot accept a captured minor payment with current consent", async () => {
  const h = await createHarness();
  const competition = await consentCompetition(h);
  const { account, childIds } = await h.seed.guardian({
    children: [{ fullName: "Asha Kulkarni", age: 9 }],
  });
  const actor = await h.signIn(account);
  const guardian = h.as(actor);
  const entry = await guardian.registerAsIndividual(
    childForm(competition, childIds[0]!, { participation: true })
  );
  if (!entry.ok) throw new Error("No registration");
  const registration = { registrationId: entry.registrationId };
  const order = await guardian.payForMyRegistration(registration);
  if (!order.ok || order.kind !== "checkout") throw new Error("No order");
  const capture = h.gateway.capture(order.checkout.orderId);
  const production = createApp({ ...h.deps, appEnv: "production" });
  expect(
    await production.as(actor).confirmMyPayment({ ...registration, ...capture })
  ).toEqual({ ok: true, outcome: "needs_review" });

  const finance = production.as((await signInStaff(h, "finance")).actor);
  const open = await finance.listPaymentReviewCases({ state: "open" });
  if (!open.ok || !open.cases[0]) throw new Error("No review case");
  const result = await finance.getPaymentReviewCase({
    caseId: open.cases[0].id,
  });
  if (!result.ok) throw new Error("No review details");
  const html = await renderHtml(
    <ReviewCaseView reviewCase={result.reviewCase} />
  );

  expect
    .soft(visibleText(html))
    .toContain("Individual participation for minors is paused.");
  expect
    .soft(visibleText(html))
    .not.toContain("The guardian must give consent");
  expect.soft(result.reviewCase.allowedOutcomes).toEqual(["refund", "keep"]);
  expect.soft(html).not.toContain('value="confirm"');
  expect(html).toContain('value="refund"');
  expect(html).toContain('value="keep"');
});

it("keeps the reason for a minor payment review visible before and after an acceptance", async () => {
  const h = await createHarness();
  const competition = await consentCompetition(h);
  const { account, childIds } = await h.seed.guardian({
    children: [{ fullName: "Riya Kulkarni", age: 9 }],
  });
  const actor = await h.signIn(account);
  const guardian = h.as(actor);
  const entry = await guardian.registerAsIndividual(
    childForm(competition, childIds[0]!, { participation: true })
  );
  if (!entry.ok) throw new Error("No registration");
  const registration = { registrationId: entry.registrationId };
  const order = await guardian.payForMyRegistration(registration);
  if (!order.ok || order.kind !== "checkout") throw new Error("No order");
  const capture = h.gateway.capture(order.checkout.orderId, {
    amount: { amountMinor: 20_000n, currency: "INR" },
  });
  expect(
    await guardian.confirmMyPayment({ ...registration, ...capture })
  ).toEqual({ ok: true, outcome: "needs_review" });

  const { actor: staff } = await signInStaff(h, "finance");
  const finance = createApp({ ...h.deps, appEnv: "production" }).as(staff);
  const open = await finance.listPaymentReviewCases({ state: "open" });
  if (!open.ok || !open.cases[0]) throw new Error("No review case");
  const review = { caseId: open.cases[0].id };
  const originalReason = "The amount received isn't what this payment was for.";
  const pause = "Individual participation for minors is paused.";
  const pending = await finance.getPaymentReviewCase(review);
  if (!pending.ok) throw new Error("No open review details");
  const openHtml = await renderHtml(
    <ReviewCaseView reviewCase={pending.reviewCase} />
  );

  expect.soft(visibleText(openHtml)).toContain(originalReason);
  expect.soft(visibleText(openHtml)).toContain(pause);
  expect.soft(openHtml).not.toContain('value="confirm"');
  expect.soft(openHtml).toContain('value="refund"');
  expect.soft(openHtml).toContain('value="keep"');

  const reason = "Finance verified and accepted the adjusted amount.";
  expect(
    await h
      .as(staff)
      .resolvePaymentReviewCase({ ...review, outcome: "confirm", reason })
  ).toEqual({ ok: true, batchStatus: "captured" });
  const settled = await finance.getPaymentReviewCase(review);
  if (!settled.ok) throw new Error("No resolved review details");
  const history = visibleText(
    await renderHtml(<ReviewCaseView reviewCase={settled.reviewCase} />)
  );

  expect.soft(history).toContain(originalReason);
  expect.soft(history).toContain("Accepted");
  expect.soft(history).toContain(reason);
  expect.soft(settled.reviewCase.allowedOutcomes).toEqual([]);
  expect(history).not.toContain(pause);
});
