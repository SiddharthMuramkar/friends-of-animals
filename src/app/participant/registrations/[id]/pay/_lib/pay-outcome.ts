// What paying came back with (#78), as the pay page says it after the
// action redirects back with `?done=`. Pure.

import type { PayForMyRegistrationResult } from "@/server/modules/participants";

export const PAY_OUTCOMES = [
  "confirmed",
  "checkout",
  "nothing_to_pay",
  "awaiting_guardian",
  "participation_consent_required",
  "fee_not_set",
  "gateway_unavailable",
  "superseded",
  "invalid_input",
] as const;

export type PayOutcome = (typeof PAY_OUTCOMES)[number];

export function isPayOutcome(value: unknown): value is PayOutcome {
  return (PAY_OUTCOMES as readonly unknown[]).includes(value);
}

/** The outcome a use-case result shows. */
export function payOutcome(result: PayForMyRegistrationResult): PayOutcome {
  if (result.ok) return result.kind === "checkout" ? "checkout" : "confirmed";
  return result.error;
}
