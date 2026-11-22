import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { isValidCheckoutSignature, isValidWebhookSignature } from "./signature";

// Razorpay's own published example (docs, "Verify Payment Signature"):
// these three values and this secret produce this signature.
const DOCS = {
  keySecret: "EnLs21M47BllR3X8PSFtjtbd",
  orderId: "order_IEIaMR65cu6nz3",
  paymentId: "pay_IH4NVgf4Dreq1l",
  signature: "0d4e745a1838664ad6c9c9902212a32d627d68e917290b0ad5f08ff4561bc50f",
};

const WEBHOOK_SECRET = "test-webhook-secret";
const BODY = '{"entity":"event","event":"payment.captured","created_at":1}';
const signed = (body: string, secret = WEBHOOK_SECRET) =>
  createHmac("sha256", secret).update(body).digest("hex");

describe("isValidCheckoutSignature()", () => {
  it("accepts Razorpay's documented example", () => {
    expect(isValidCheckoutSignature(DOCS, DOCS.keySecret)).toBe(true);
  });

  it("accepts the signature in upper case hex too", () => {
    expect(
      isValidCheckoutSignature(
        { ...DOCS, signature: DOCS.signature.toUpperCase() },
        DOCS.keySecret
      )
    ).toBe(true);
  });

  it("refuses it for another order: the order id must be the one we stored", () => {
    expect(
      isValidCheckoutSignature(
        { ...DOCS, orderId: "order_SOMEONEELSE" },
        DOCS.keySecret
      )
    ).toBe(false);
  });

  it("refuses it for another payment", () => {
    expect(
      isValidCheckoutSignature(
        { ...DOCS, paymentId: "pay_SOMEONEELSE1" },
        DOCS.keySecret
      )
    ).toBe(false);
  });

  it("refuses it under another key secret", () => {
    expect(isValidCheckoutSignature(DOCS, "another-secret")).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["short", DOCS.signature.slice(0, 63)],
    ["long", `${DOCS.signature}0`],
    ["not hex", `${DOCS.signature.slice(0, 63)}z`],
  ])("refuses a signature that is %s, without throwing", (_, signature) => {
    expect(
      isValidCheckoutSignature({ ...DOCS, signature }, DOCS.keySecret)
    ).toBe(false);
  });

  it("throws when the key secret is missing, so a misconfiguration fails closed and loudly", () => {
    expect(() => isValidCheckoutSignature(DOCS, "")).toThrow(TypeError);
  });
});

describe("isValidWebhookSignature()", () => {
  it("accepts the HMAC-SHA256 of the raw body under the webhook secret", () => {
    expect(isValidWebhookSignature(BODY, signed(BODY), WEBHOOK_SECRET)).toBe(
      true
    );
  });

  it("refuses a body changed by even one character", () => {
    const tampered = BODY.replace('"created_at":1', '"created_at":2');
    expect(
      isValidWebhookSignature(tampered, signed(BODY), WEBHOOK_SECRET)
    ).toBe(false);
  });

  it("refuses a body that was re-serialised: it must be the raw bytes", () => {
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(
      isValidWebhookSignature(reserialised, signed(BODY), WEBHOOK_SECRET)
    ).toBe(false);
  });

  it("refuses a signature made with another secret", () => {
    expect(
      isValidWebhookSignature(BODY, signed(BODY, "other"), WEBHOOK_SECRET)
    ).toBe(false);
  });

  it("refuses a missing signature header", () => {
    expect(isValidWebhookSignature(BODY, null, WEBHOOK_SECRET)).toBe(false);
  });

  it("throws when the webhook secret is missing", () => {
    expect(() => isValidWebhookSignature(BODY, signed(BODY), "")).toThrow(
      TypeError
    );
  });
});
