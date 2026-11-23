import { describe, expect, it } from "vitest";

import {
  batchRow,
  openOrder,
  paymentRows,
  registrationsOf,
  schoolWithStudents,
} from "@/server/modules/payments/testing";
import { createHarness } from "@/test/harness";

import {
  receiveWebhookRequest,
  WEBHOOK_MAX_BYTES,
  webhookActor,
} from "./gateway-webhook";

function post(rawBody: string, headers: Headers): Request {
  return new Request("http://localhost:3000/api/webhooks/razorpay", {
    method: "POST",
    body: rawBody,
    headers,
  });
}

async function paidOrder() {
  const h = await createHarness();
  const school = await schoolWithStudents(h, { students: 2 });
  const { batchId, orderId } = await openOrder(school);
  h.gateway.capture(orderId);
  const app = h.as(webhookActor(new Headers({ "user-agent": "Razorpay" })));
  return { h, school, batchId, orderId, app };
}

describe("receiveWebhookRequest", () => {
  it("answers a genuine webhook 200 and the batch is captured, uncached", async () => {
    const { h, school, batchId, orderId, app } = await paidOrder();
    const { rawBody, headers } = h.gateway.webhook({
      type: "payment.captured",
      orderId,
    });

    const response = await receiveWebhookRequest(
      app,
      post(rawBody, headers),
      h.errors
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await batchRow(h, batchId)).status).toBe("captured");
    expect(
      (await registrationsOf(h, school.registrationIds)).map((r) => r.status)
    ).toEqual(["confirmed", "confirmed"]);
  });

  it("answers a replay 200 and changes nothing", async () => {
    const { h, orderId, app } = await paidOrder();
    const { rawBody, headers } = h.gateway.webhook({
      type: "payment.captured",
      orderId,
    });
    await receiveWebhookRequest(app, post(rawBody, headers), h.errors);
    const before = await paymentRows(h);

    const replay = await receiveWebhookRequest(
      app,
      post(rawBody, headers),
      h.errors
    );

    expect(replay.status).toBe(200);
    expect(await paymentRows(h)).toEqual(before);
  });

  it.each(["invalid", "missing"] as const)(
    "answers 400 to a webhook whose signature is %s, and stores nothing",
    async (signature) => {
      const { h, batchId, orderId, app } = await paidOrder();
      const before = await paymentRows(h);
      const { rawBody, headers } = h.gateway.webhook(
        { type: "payment.captured", orderId },
        { signature }
      );

      const response = await receiveWebhookRequest(
        app,
        post(rawBody, headers),
        h.errors
      );

      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await paymentRows(h)).toEqual(before);
      expect((await batchRow(h, batchId)).status).toBe("order_created");
    }
  );

  it("refuses a body over the cap with 413 before anything reads it", async () => {
    const { h, orderId, app } = await paidOrder();
    const before = await paymentRows(h);
    const { headers } = h.gateway.webhook({
      type: "payment.captured",
      orderId,
    });

    const response = await receiveWebhookRequest(
      app,
      post("x".repeat(WEBHOOK_MAX_BYTES + 1), headers),
      h.errors
    );

    expect(response.status).toBe(413);
    expect(await paymentRows(h)).toEqual(before);
  });

  it("answers 500 while the gateway can't be asked, reports it, and a retry then captures", async () => {
    const { h, batchId, orderId, app } = await paidOrder();
    const { rawBody, headers } = h.gateway.webhook({
      type: "payment.captured",
      orderId,
    });
    h.gateway.failNextFetch();

    const failed = await receiveWebhookRequest(
      app,
      post(rawBody, headers),
      h.errors
    );

    expect(failed.status).toBe(500);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    expect(h.errors.reported).toHaveLength(1);
    expect(h.errors.reported[0]).toMatchObject({
      tags: { where: "webhooks.gateway" },
    });
    expect((await batchRow(h, batchId)).status).toBe("order_created");

    // The gateway retries the same delivery.
    const retried = await receiveWebhookRequest(
      app,
      post(rawBody, headers),
      h.errors
    );

    expect(retried.status).toBe(200);
    expect((await batchRow(h, batchId)).status).toBe("captured");
  });
});

describe("webhookActor", () => {
  it("is a visitor, whom the webhook use case accepts: the signature authorises it", () => {
    expect(
      webhookActor(
        new Headers({
          "x-forwarded-for": "203.0.113.7, 10.0.0.1",
          "user-agent": "Razorpay-Webhook/v1",
        })
      )
    ).toEqual({
      kind: "visitor",
      meta: { ip: "203.0.113.7", userAgent: "Razorpay-Webhook/v1" },
    });
  });
});
