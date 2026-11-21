import { describe, expect, it } from "vitest";

import { razorpayWebhook, signRazorpayBody } from "./testing";
import { readRazorpayWebhook } from "./webhook";

const SECRET = "webhook-secret-for-tests";

/** Razorpay's documented payment.captured example (webhooks docs). */
const DOCUMENTED_CAPTURE = JSON.stringify({
  entity: "event",
  account_id: "acc_Hn1ukn2d32Fqww",
  event: "payment.captured",
  contains: ["payment"],
  payload: {
    payment: {
      entity: {
        id: "pay_JRP3Y66cNcf2qF",
        entity: "payment",
        amount: 2244,
        currency: "INR",
        status: "captured",
        order_id: "order_JROxH1kSf9IR6d",
        method: "card",
        captured: true,
      },
    },
  },
  created_at: 1651722476,
});

function delivered(
  rawBody: string,
  headers: Record<string, string> = {}
): [string, Headers] {
  return [
    rawBody,
    new Headers({
      "x-razorpay-signature": signRazorpayBody(rawBody, SECRET),
      "x-razorpay-event-id": "evt_JRP3YhM2yd8L2E",
      ...headers,
    }),
  ];
}

describe("readRazorpayWebhook()", () => {
  it("reads a signed event: its id from the header, its type and the payment's order", () => {
    expect(
      readRazorpayWebhook(...delivered(DOCUMENTED_CAPTURE), SECRET)
    ).toEqual({
      eventId: "evt_JRP3YhM2yd8L2E",
      type: "payment.captured",
      orderId: "order_JROxH1kSf9IR6d",
    });
  });

  it("reads the order of an order.paid event", () => {
    const { rawBody, headers } = razorpayWebhook(
      { type: "order.paid", orderId: "order_PaidOrder0001" },
      { secret: SECRET, eventId: "evt_OrderPaid0001" }
    );

    expect(readRazorpayWebhook(rawBody, headers, SECRET)).toEqual({
      eventId: "evt_OrderPaid0001",
      type: "order.paid",
      orderId: "order_PaidOrder0001",
    });
  });

  it("falls back to payload.order.entity.id when the event carries no payment", () => {
    const body = JSON.stringify({
      entity: "event",
      event: "order.paid",
      payload: { order: { entity: { id: "order_OnlyTheOrder01" } } },
    });

    expect(readRazorpayWebhook(...delivered(body), SECRET)?.orderId).toBe(
      "order_OnlyTheOrder01"
    );
  });

  it("names no order for an event about none, and still returns it", () => {
    const body = JSON.stringify({
      entity: "event",
      event: "settlement.processed",
      payload: { settlement: { entity: { id: "setl_DGlQ1Rj8os78Ne" } } },
    });

    expect(readRazorpayWebhook(...delivered(body), SECRET)).toEqual({
      eventId: "evt_JRP3YhM2yd8L2E",
      type: "settlement.processed",
      orderId: null,
    });
  });

  it("checks the exact bytes it got, spacing included", () => {
    const spaced = JSON.stringify(JSON.parse(DOCUMENTED_CAPTURE), null, 2);

    expect(readRazorpayWebhook(...delivered(spaced), SECRET)?.orderId).toBe(
      "order_JROxH1kSf9IR6d"
    );
  });

  it.each([
    [
      "the signature header is missing",
      () => {
        const [body, headers] = delivered(DOCUMENTED_CAPTURE);
        headers.delete("x-razorpay-signature");
        return [body, headers] as const;
      },
    ],
    [
      "the signature is for another body",
      () => {
        const [, headers] = delivered(DOCUMENTED_CAPTURE);
        return [
          DOCUMENTED_CAPTURE.replace("pay_JRP3Y66cNcf2qF", "pay_Forged0000001"),
          headers,
        ] as const;
      },
    ],
    [
      "the body was signed with another secret",
      () =>
        delivered(DOCUMENTED_CAPTURE, {
          "x-razorpay-signature": signRazorpayBody(
            DOCUMENTED_CAPTURE,
            "someone-elses-secret"
          ),
        }),
    ],
    [
      "the signature is not hex",
      () =>
        delivered(DOCUMENTED_CAPTURE, { "x-razorpay-signature": "forged" }),
    ],
  ])("returns null when %s", (_, make) => {
    const [body, headers] = make();
    expect(readRazorpayWebhook(body, headers, SECRET)).toBeNull();
  });

  it("returns null for a signed event without an event id, which can't be deduplicated", () => {
    const [body, headers] = delivered(DOCUMENTED_CAPTURE);
    headers.delete("x-razorpay-event-id");

    expect(readRazorpayWebhook(body, headers, SECRET)).toBeNull();
  });

  it.each([
    ["not JSON", "this is not json"],
    ["a JSON array", "[]"],
    ["an object without an event", JSON.stringify({ payload: {} })],
  ])("returns null for a signed body that is %s", (_, body) => {
    expect(readRazorpayWebhook(...delivered(body), SECRET)).toBeNull();
  });

  it("throws when the webhook secret is empty, so a misconfiguration is loud", () => {
    expect(() =>
      readRazorpayWebhook(...delivered(DOCUMENTED_CAPTURE), "")
    ).toThrow(TypeError);
  });
});
