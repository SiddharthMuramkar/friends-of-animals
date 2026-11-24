// What the conduct page says after a coordinator presses "Certify conduct"
// (#87), from certifyConduct's result or the error it threw. Pure, so the
// mapping is tested without a page; the page translates the key.

import { DomainError } from "@/server/errors";
import type { CertifyConductResult } from "@/server/modules/institution-submissions";

export const CONDUCT_OUTCOMES = [
  "certified",
  "already_certified",
  "no_confirmed_students",
  "competition_cancelled",
  "not_found",
  "forbidden",
  "failed",
] as const;

export type ConductOutcome = (typeof CONDUCT_OUTCOMES)[number];

export function isConductOutcome(value: unknown): value is ConductOutcome {
  return (CONDUCT_OUTCOMES as readonly unknown[]).includes(value);
}

/** The outcome of a certification attempt that returned. */
export function conductOutcome(result: CertifyConductResult): ConductOutcome {
  if (result.ok) return "certified";
  return result.error === "invalid_input" ? "not_found" : result.error;
}

/** The outcome of one that threw: refused, or anything else. */
export function conductError(error: unknown): ConductOutcome {
  return error instanceof DomainError && error.code === "forbidden"
    ? "forbidden"
    : "failed";
}
