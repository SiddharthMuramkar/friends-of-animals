// Test doubles for Razorpay, shaped like its documented API:
//   - `razorpayWebhook`: a webhook as Razorpay delivers it, the documented
//     event envelope with the raw body signed (hex HMAC-SHA256 under the
//     webhook secret) in X-Razorpay-Signature;
//   - `fakeRazorpayApi`: a `fetch` that answers the two endpoints the
//     adapter calls (POST /v1/orders, GET /v1/orders/{id}/payments) with
//     Basic auth, records every request, and lets a test play the payer.
// Tests only: nothing in the app imports this file.

import { createHmac } from "node:crypto";

/** What a simulated event is about. */
export type SimulatedEvent = {
  /** For example "payment.captured", "payment.failed" or "order.paid". */
  type: string;
  orderId: string;
  paymentId?: string;
  amountMinor?: bigint;
};

let sequence = 0;

/** A Razorpay-style id: the prefix, then 14 characters. */
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}_Test${String(sequence).padStart(10, "0")}`;
}

/**
 * The event body Razorpay sends, shaped like its documented examples. Each
 * call is a new event, so its body (payment id, timestamps) is new too.
 */
export function razorpayEventBody(event: SimulatedEvent): string {
  const amount = Number(event.amountMinor ?? 50_000n);
  const createdAt = 1_798_000_000 + sequence;
  const payment = {
    id: event.paymentId ?? nextId("pay"),
    entity: "payment",
    amount,
    currency: "INR",
    status: event.type === "payment.failed" ? "failed" : "captured",
    order_id: event.orderId,
    method: "upi",
    captured: event.type !== "payment.failed",
    created_at: createdAt,
  };
  const order = {
    id: event.orderId,
    entity: "order",
    amount,
    amount_paid: amount,
    amount_due: 0,
    currency: "INR",
    status: "paid",
  };
  const payload =
    event.type === "order.paid"
      ? { payment: { entity: payment }, order: { entity: order } }
      : { payment: { entity: payment } };
  return JSON.stringify({
    entity: "event",
    account_id: "acc_TestAccount01",
    event: event.type,
    contains: Object.keys(payload),
    payload,
    created_at: createdAt + 5,
  });
}

/** Hex HMAC-SHA256 of `message` under `secret`, as Razorpay signs. */
export function signRazorpayBody(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * A new webhook as Razorpay delivers it. `signature: "invalid"` signs the
 * body with another secret, as a forger who lacks ours would; "missing"
 * leaves the header out.
 */
export function razorpayWebhook(
  event: SimulatedEvent,
  {
    secret,
    signature = "valid",
  }: { secret: string; signature?: "valid" | "invalid" | "missing" }
): { rawBody: string; headers: Headers } {
  const rawBody = razorpayEventBody(event);
  const headers = new Headers({
    "content-type": "application/json",
    "x-razorpay-event-id": nextId("evt"),
  });
  if (signature !== "missing") {
    const key = signature === "valid" ? secret : `not-${secret}`;
    headers.set("x-razorpay-signature", signRazorpayBody(rawBody, key));
  }
  return { rawBody, headers };
}

/** One request the fake API received. */
export type RecordedRequest = {
  method: string;
  url: string;
  authorization: string | null;
  contentType: string | null;
  /** The parsed JSON body; null for a request without one. */
  body: unknown;
};

type FakeOrder = { id: string; amount: number; currency: string };

type FakePayment = {
  id: string;
  entity: "payment";
  amount: number;
  currency: string;
  status: string;
  order_id: string;
  method: string;
  captured: boolean;
  created_at: number;
};

const API = "https://api.razorpay.com";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function badRequest(description: string, status = 400): Response {
  return json(status, {
    error: {
      code: "BAD_REQUEST_ERROR",
      description,
      source: "business",
      step: "payment_initiation",
      reason: "input_validation_failed",
    },
  });
}

/**
 * Razorpay's orders API, in memory, for one key pair. Answers like the
 * documented API: 401 without the right Basic credentials, 400 for an
 * order under ₹1 (100 paise) or an unknown order id.
 */
export function fakeRazorpayApi({
  keyId,
  keySecret,
}: {
  keyId: string;
  keySecret: string;
}) {
  const requests: RecordedRequest[] = [];
  const orders: FakeOrder[] = [];
  const payments: FakePayment[] = [];
  const outages: number[] = [];
  const expectedAuth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

  async function handle(
    input: string | URL | Request,
    init: RequestInit = {}
  ): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.text();
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.get("authorization"),
      contentType: request.headers.get("content-type"),
      body: text === "" ? null : (JSON.parse(text) as unknown),
    });
    const outage = outages.shift();
    if (outage !== undefined) {
      return json(outage, {
        error: { code: "SERVER_ERROR", description: "The server is down" },
      });
    }
    if (url.origin !== API) return badRequest("Unknown host", 404);
    if (request.headers.get("authorization") !== expectedAuth) {
      return badRequest("Authentication failed", 401);
    }

    if (request.method === "POST" && url.pathname === "/v1/orders") {
      const body = JSON.parse(text) as {
        amount?: unknown;
        currency?: unknown;
        receipt?: unknown;
        notes?: unknown;
      };
      if (!Number.isSafeInteger(body.amount) || (body.amount as number) < 100) {
        return badRequest("The amount must be atleast INR 1.00", 400);
      }
      if (body.currency !== "INR")
        return badRequest("Currency is not supported");
      if (typeof body.receipt === "string" && body.receipt.length > 40) {
        return badRequest("receipt: the length must be no more than 40.");
      }
      const order: FakeOrder = {
        id: nextId("order"),
        amount: body.amount as number,
        currency: "INR",
      };
      orders.push(order);
      return json(200, {
        id: order.id,
        entity: "order",
        amount: order.amount,
        amount_paid: 0,
        amount_due: order.amount,
        currency: order.currency,
        receipt: body.receipt ?? null,
        offer_id: null,
        status: "created",
        attempts: 0,
        notes: body.notes ?? [],
        created_at: 1_798_000_000,
      });
    }

    const paymentsPath = /^\/v1\/orders\/([^/]+)\/payments$/.exec(url.pathname);
    if (request.method === "GET" && paymentsPath) {
      const orderId = decodeURIComponent(paymentsPath[1]!);
      if (!orders.some((order) => order.id === orderId)) {
        return badRequest("The id provided does not exist");
      }
      const items = payments.filter((payment) => payment.order_id === orderId);
      return json(200, { entity: "collection", count: items.length, items });
    }

    return badRequest("The requested URL was not found on the server.", 404);
  }

  function attempt(orderId: string, status: string, amount?: bigint): string {
    const order = orders.find((each) => each.id === orderId);
    if (!order) throw new Error(`fakeRazorpayApi: no order ${orderId}`);
    const payment: FakePayment = {
      id: nextId("pay"),
      entity: "payment",
      amount: amount === undefined ? order.amount : Number(amount),
      currency: order.currency,
      status,
      order_id: orderId,
      method: "upi",
      captured: status === "captured",
      created_at: 1_798_000_100,
    };
    payments.push(payment);
    return payment.id;
  }

  return {
    fetch: handle as typeof fetch,
    requests,
    /**
     * The payer pays `orderId` (its amount, or `amount`) and Checkout hands
     * back the payment id and Razorpay's signature for it.
     */
    capture(
      orderId: string,
      amount?: bigint
    ): { paymentId: string; signature: string } {
      const paymentId = attempt(orderId, "captured", amount);
      return {
        paymentId,
        signature: signRazorpayBody(`${orderId}|${paymentId}`, keySecret),
      };
    },
    /** A payment attempt on `orderId` in another state, e.g. "failed". */
    attempt(orderId: string, status: string): string {
      return attempt(orderId, status);
    },
    /** The next request gets this HTTP status, as an outage would. */
    failNext(status = 503): void {
      outages.push(status);
    },
  };
}
