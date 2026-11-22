import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import { PaymentGatewayNotConfiguredError } from "./payment-gateway";
import {
  paymentGatewayFor,
  selectPaymentGateway,
  type PaymentGatewayEnv,
} from "./payment-gateway-select";

const TEST_KEYS = {
  RAZORPAY_KEY_ID: "rzp_test_1DP5mmOlF5G5ag",
  RAZORPAY_KEY_SECRET: "test-key-secret",
  RAZORPAY_WEBHOOK_SECRET: "test-webhook-secret",
};
const LIVE_KEYS = { ...TEST_KEYS, RAZORPAY_KEY_ID: "rzp_live_1DP5mmOlF5G5ag" };

const keysOf = (env: typeof TEST_KEYS) => ({
  keyId: env.RAZORPAY_KEY_ID,
  keySecret: env.RAZORPAY_KEY_SECRET,
  webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
});

describe("selectPaymentGateway", () => {
  it.each<[string, PaymentGatewayEnv, ReturnType<typeof selectPaymentGateway>]>(
    [
      [
        "production with live keys: Razorpay",
        { APP_ENV: "production", ...LIVE_KEYS },
        { kind: "razorpay", keys: keysOf(LIVE_KEYS) },
      ],
      [
        "production without keys: nothing, so nothing is paid",
        { APP_ENV: "production" },
        { kind: "unconfigured", reason: "no_keys" },
      ],
      [
        "production with test keys: nothing, test money never confirms a real registration",
        { APP_ENV: "production", ...TEST_KEYS },
        { kind: "unconfigured", reason: "test_keys_in_production" },
      ],
      ...(["local", "preview", "staging"] as const).flatMap(
        (
          appEnv
        ): [
          string,
          PaymentGatewayEnv,
          ReturnType<typeof selectPaymentGateway>,
        ][] => [
          [
            `${appEnv} with test keys: Razorpay test mode`,
            { APP_ENV: appEnv, ...TEST_KEYS },
            { kind: "razorpay", keys: keysOf(TEST_KEYS) },
          ],
          [
            `${appEnv} without keys: the fallback`,
            { APP_ENV: appEnv },
            { kind: "fallback" },
          ],
          [
            `${appEnv} with live keys: nothing, real money stays in production`,
            { APP_ENV: appEnv, ...LIVE_KEYS },
            { kind: "unconfigured", reason: "live_keys_outside_production" },
          ],
        ]
      ),
    ]
  )("%s", (_, env, expected) => {
    expect(selectPaymentGateway(env)).toEqual(expected);
  });

  it("treats half a key set as none", () => {
    expect(
      selectPaymentGateway({
        APP_ENV: "production",
        RAZORPAY_KEY_ID: LIVE_KEYS.RAZORPAY_KEY_ID,
        RAZORPAY_KEY_SECRET: LIVE_KEYS.RAZORPAY_KEY_SECRET,
      })
    ).toEqual({ kind: "unconfigured", reason: "no_keys" });
  });
});

describe("paymentGatewayFor", () => {
  it("builds the selected adapter", async () => {
    const h = await createHarness();
    const deps = { db: h.db, clock: h.clock };

    expect(
      paymentGatewayFor({ APP_ENV: "production", ...LIVE_KEYS }, deps).name
    ).toBe("razorpay");
    expect(
      paymentGatewayFor({ APP_ENV: "preview", ...TEST_KEYS }, deps).name
    ).toBe("razorpay-test");
    expect(paymentGatewayFor({ APP_ENV: "local" }, deps).name).toBe("fallback");
  });

  it("fails closed in production without live keys: the first payment throws and says why", async () => {
    const h = await createHarness();
    const gateway = paymentGatewayFor(
      { APP_ENV: "production", ...TEST_KEYS },
      { db: h.db, clock: h.clock }
    );

    expect(gateway.name).toBe("unconfigured");
    const refused = gateway.createOrder({
      amount: { amountMinor: 50_000n, currency: "INR" },
      receipt: "batch",
      notes: {},
    });
    await expect(refused).rejects.toThrow(PaymentGatewayNotConfiguredError);
    await expect(refused).rejects.toThrow(/rzp_live_/);
    expect(
      gateway.verifyCheckout({
        orderId: "order",
        paymentId: "pay",
        signature: "0".repeat(64),
      })
    ).toBe(false);
    expect(gateway.readWebhook("{}", new Headers())).toBeNull();
  });
});
