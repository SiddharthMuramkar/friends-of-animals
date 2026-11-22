// Which payment-gateway adapter an environment uses (#77), from its
// APP_ENV and Razorpay keys alone, so the choice is explicit and testable:
//
//   APP_ENV       keys set         adapter
//   production    rzp_live_        Razorpay
//   production    rzp_test_/none   none: every payment is refused
//   other         rzp_test_        Razorpay in test mode
//   other         rzp_live_        none: real money stays in production
//   other         none             the fallback with its test checkout
//
// "None" fails closed: the app starts, and the first payment throws and
// says why (PaymentGatewayNotConfiguredError). Test keys never confirm a
// registration in production, and a test deployment never takes real
// money. The three variables come together or not at all (src/env.schema.ts);
// half a set counts as none.
//
// Loads under plain Node: relative imports only.

import type { AppDb } from "../db/app-db";
import type { Clock } from "./clock";
import {
  PaymentGatewayNotConfiguredError,
  type PaymentGateway,
} from "./payment-gateway";
import { fallbackPaymentGateway } from "./payment-gateway-fallback";
import { razorpayGateway, type RazorpayKeys } from "./razorpay/gateway";

export type PaymentGatewayEnv = {
  APP_ENV: "local" | "preview" | "staging" | "production";
  RAZORPAY_KEY_ID?: string | undefined;
  RAZORPAY_KEY_SECRET?: string | undefined;
  RAZORPAY_WEBHOOK_SECRET?: string | undefined;
};

export type PaymentGatewaySelection =
  | { kind: "razorpay"; keys: RazorpayKeys }
  | { kind: "fallback" }
  | {
      kind: "unconfigured";
      reason:
        | "no_keys"
        | "test_keys_in_production"
        | "live_keys_outside_production";
    };

const REASONS = {
  no_keys:
    "Production takes payments through Razorpay's live keys " +
    "(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET), which " +
    "are not set.",
  test_keys_in_production:
    "RAZORPAY_KEY_ID is a test key; production needs a rzp_live_ key.",
  live_keys_outside_production:
    "RAZORPAY_KEY_ID is a live key; only production may use rzp_live_ keys. " +
    "Set test keys (rzp_test_) here, or none for the fallback.",
} as const;

/** Which adapter `env` gets. Pure. */
export function selectPaymentGateway(
  env: PaymentGatewayEnv
): PaymentGatewaySelection {
  const {
    APP_ENV,
    RAZORPAY_KEY_ID: keyId,
    RAZORPAY_KEY_SECRET: keySecret,
    RAZORPAY_WEBHOOK_SECRET: webhookSecret,
  } = env;
  const production = APP_ENV === "production";
  if (!keyId || !keySecret || !webhookSecret) {
    return production
      ? { kind: "unconfigured", reason: "no_keys" }
      : { kind: "fallback" };
  }
  const live = keyId.startsWith("rzp_live_");
  if (production && !live) {
    return { kind: "unconfigured", reason: "test_keys_in_production" };
  }
  if (!production && live) {
    return { kind: "unconfigured", reason: "live_keys_outside_production" };
  }
  return { kind: "razorpay", keys: { keyId, keySecret, webhookSecret } };
}

/** A gateway that refuses every payment and says why. */
function refusing(reason: string): PaymentGateway {
  const refuse = () => new PaymentGatewayNotConfiguredError(reason);
  return {
    name: "unconfigured",
    createOrder: () => Promise.reject(refuse()),
    checkout: () => {
      throw refuse();
    },
    verifyCheckout: () => false,
    readWebhook: () => null,
    fetchOrderPayments: () => Promise.reject(refuse()),
  };
}

/** The adapter `env` gets, built. */
export function paymentGatewayFor(
  env: PaymentGatewayEnv,
  deps: { db: AppDb; clock: Clock; fetch?: typeof fetch }
): PaymentGateway {
  const selection = selectPaymentGateway(env);
  switch (selection.kind) {
    case "razorpay":
      return razorpayGateway({
        ...selection.keys,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
    case "fallback":
      return fallbackPaymentGateway({ ...deps, appEnv: env.APP_ENV });
    case "unconfigured":
      return refusing(REASONS[selection.reason]);
  }
}
