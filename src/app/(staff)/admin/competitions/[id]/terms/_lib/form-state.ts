// What the terms forms show after a save. Pure, so the mapping from a use
// case's result to the form is tested without a page.

import { secondFactorPath } from "@/lib/second-factor-routes";
import { DomainError } from "@/server/errors";
import type {
  RoundAwardPlan,
  RoundAwardsError,
} from "@/server/modules/competitions/domain/award-schemes";
import {
  formatPaiseForInput,
  type FeeLine,
  type ParticipationRoute,
} from "@/server/modules/competitions/domain/fees";
import type {
  SetCompetitionFeesResult,
  SetRoundAwardsResult,
} from "@/server/modules/competitions/terms";

import { competitionTermsPath } from "./paths";

export type FeesEntered = {
  mode: "free" | "paid";
  fees: Partial<Record<ParticipationRoute, string>>;
};

/**
 * The fees form as stored: rupees per offered route (0 for free, empty
 * while not set), and "free" when every offered route is.
 */
export function feesEnteredFrom(lines: readonly FeeLine[]): FeesEntered {
  const fees: FeesEntered["fees"] = {};
  for (const line of lines) {
    fees[line.route] =
      line.kind === "amount"
        ? formatPaiseForInput(line.paise)
        : line.kind === "free"
          ? "0"
          : "";
  }
  const free = lines.length > 0 && lines.every((line) => line.kind === "free");
  return { mode: free ? "free" : "paid", fees };
}

export type FeeFieldError =
  | "missing_fee"
  | "invalid_amount"
  | "too_large"
  | "route_not_offered";

export type FeesFormState = {
  /** What was typed, put back after the form resets. */
  entered: FeesEntered;
  outcome?: "saved" | "unchanged";
  /** A problem for the whole form. */
  alert?: "failed" | "locked" | "noParticipation" | "currency";
  fieldErrors: Partial<Record<ParticipationRoute, FeeFieldError>>;
};

export function afterSetFees(
  result: SetCompetitionFeesResult,
  entered: FeesEntered
): FeesFormState {
  if (result.ok) {
    return {
      entered,
      outcome: result.changed ? "saved" : "unchanged",
      fieldErrors: {},
    };
  }
  switch (result.error) {
    case "fees_locked":
      return { entered, alert: "locked", fieldErrors: {} };
    case "participation_not_set":
      return { entered, alert: "noParticipation", fieldErrors: {} };
    case "invalid_fees": {
      const fieldErrors: FeesFormState["fieldErrors"] = {};
      for (const problem of result.problems) {
        if (problem.code === "unsupported_currency") {
          return { entered, alert: "currency", fieldErrors: {} };
        }
        fieldErrors[problem.route] = problem.code;
      }
      return { entered, fieldErrors };
    }
    default:
      // Not found, or input the form never sends.
      return { entered, alert: "failed", fieldErrors: {} };
  }
}

export type AwardsEntered = {
  scheme: string;
  prizes: Partial<Record<string, string>>;
};

/** One round's form as stored: its scheme and each band's prize. */
export function awardsEnteredFrom(round: RoundAwardPlan): AwardsEntered {
  return {
    scheme: round.scheme,
    prizes: Object.fromEntries(
      round.bands.map(({ band, prize }) => [band, prize ?? ""])
    ),
  };
}

export type AwardsFormState = {
  entered: AwardsEntered;
  outcome?: "saved" | "unchanged";
  error?: RoundAwardsError | "failed";
};

export function afterSetRoundAwards(
  result: SetRoundAwardsResult,
  entered: AwardsEntered
): AwardsFormState {
  if (result.ok) {
    return { entered, outcome: result.changed ? "saved" : "unchanged" };
  }
  if (result.error === "not_found" || result.error === "invalid_input") {
    return { entered, error: "failed" };
  }
  return { entered, error: result.error };
}

/**
 * Where a change refused for want of a second factor sends the manager:
 * fees are money, so they step up (#60), then come back to this page to
 * save again. Null for anything else.
 */
export function secondFactorRedirect(
  error: unknown,
  competitionId: string
): string | null {
  if (!(error instanceof DomainError)) return null;
  return secondFactorPath(error.code, competitionTermsPath(competitionId));
}
