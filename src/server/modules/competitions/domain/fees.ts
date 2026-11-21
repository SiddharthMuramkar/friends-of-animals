// Competition fees (#72): one fee per participation route, in paise, or
// free. Amounts are configuration that FOA enters; none are invented here.
// Money is bigint paise end to end (column `bigint`, mode "bigint"), so an
// amount never passes through a float on its way to the database.
//
// Plain TypeScript with type-only relative imports, so the schema file and
// the seed script can load it under plain Node.

import type { Participation } from "./vocabulary";

/** Who pays: a person entering alone, or an institution for its students. */
export const PARTICIPATION_ROUTES = ["individual", "institution"] as const;

export type ParticipationRoute = (typeof PARTICIPATION_ROUTES)[number];

/** The only currency: FOA takes domestic INR only (#55). */
export const FEE_CURRENCY = "INR";

/** The largest amount a Postgres `bigint` column holds. */
export const MAX_PAISE = 9_223_372_036_854_775_807n;

/**
 * The routes a competition offers, in `PARTICIPATION_ROUTES` order. None
 * while a draft has no participation chosen.
 */
export function offeredRoutes(
  participation: Participation | null
): ParticipationRoute[] {
  switch (participation) {
    case null:
      return [];
    case "individuals":
      return ["individual"];
    case "institutions":
      return ["institution"];
    case "both":
      return ["individual", "institution"];
  }
}

export type AmountError = "empty" | "invalid_amount" | "too_large";

// Whole rupees: plain digits, or grouped the Indian way (1,24,000) or the
// international way (124,000). A comma anywhere else is a typo, not a
// separator, so it is refused rather than guessed at.
const PLAIN = /^\d+$/;
const INDIAN_GROUPS = /^\d{1,2}(?:,\d{2})*,\d{3}$/;
const THOUSANDS_GROUPS = /^\d{1,3}(?:,\d{3})+$/;
const AMOUNT = /^(?<whole>[\d,]+)(?:\.(?<fraction>\d{1,2}))?$/;

/**
 * Reads an amount in rupees, as a manager types it ("1,500", "₹1,500.50",
 * "0"), into paise. Refuses negatives, more than two decimals, exponents
 * and anything a `bigint` column can't hold.
 */
export function parseRupeesToPaise(
  input: string
): { ok: true; paise: bigint } | { ok: false; error: AmountError } {
  const text = input.trim().replace(/^₹\s*/, "");
  if (text === "") return { ok: false, error: "empty" };
  const match = AMOUNT.exec(text);
  const whole = match?.groups?.["whole"];
  if (
    whole === undefined ||
    !(
      PLAIN.test(whole) ||
      INDIAN_GROUPS.test(whole) ||
      THOUSANDS_GROUPS.test(whole)
    )
  ) {
    return { ok: false, error: "invalid_amount" };
  }
  const fraction = (match?.groups?.["fraction"] ?? "").padEnd(2, "0");
  const paise = BigInt(whole.replaceAll(",", "")) * 100n + BigInt(fraction);
  if (paise > MAX_PAISE) return { ok: false, error: "too_large" };
  return { ok: true, paise };
}

/**
 * Writes paise back as the admin form shows it: "1500", or "1500.50" when
 * there are paise. `parseRupeesToPaise` reads it back to the same amount.
 */
export function formatPaiseForInput(paise: bigint): string {
  if (paise < 0n) throw new RangeError("A fee is never negative");
  const rupees = paise / 100n;
  const rest = paise % 100n;
  return rest === 0n
    ? rupees.toString()
    : `${rupees}.${rest.toString().padStart(2, "0")}`;
}

/** What the manager submits: a fee per route, or the whole thing free. */
export type FeeInput =
  | { free: true }
  | {
      fees: Partial<Record<ParticipationRoute, string>>;
      currency: string;
    };

export type FeeProblem =
  | { code: "unsupported_currency" }
  | {
      code:
        | "missing_fee"
        | "invalid_amount"
        | "too_large"
        | "route_not_offered";
      route: ParticipationRoute;
    };

export type Fees = Partial<Record<ParticipationRoute, bigint>>;

/**
 * Decides the fees to store for a competition with this participation:
 * one amount for every offered route (0 = free), and nothing for a route it
 * doesn't offer. Returns every problem at once so the form can show them
 * all.
 */
export function decideFees(
  participation: Participation,
  input: FeeInput
): { ok: true; fees: Fees } | { ok: false; problems: FeeProblem[] } {
  const offered = offeredRoutes(participation);
  if ("free" in input) {
    return {
      ok: true,
      fees: Object.fromEntries(offered.map((route) => [route, 0n])),
    };
  }
  if (input.currency !== FEE_CURRENCY) {
    return { ok: false, problems: [{ code: "unsupported_currency" }] };
  }
  const fees: Fees = {};
  const problems: FeeProblem[] = [];
  for (const route of PARTICIPATION_ROUTES) {
    const typed = input.fees[route] ?? "";
    if (!offered.includes(route)) {
      if (typed.trim() !== "")
        problems.push({ code: "route_not_offered", route });
      continue;
    }
    const amount = parseRupeesToPaise(typed);
    if (amount.ok) fees[route] = amount.paise;
    else
      problems.push({
        code: amount.error === "empty" ? "missing_fee" : amount.error,
        route,
      });
  }
  return problems.length === 0 ? { ok: true, fees } : { ok: false, problems };
}

/**
 * Statuses in which fees may still change. Once registration opens, people
 * have registered (and paid) at the stored amounts, so the fees are locked.
 * A status later tickets add stays locked unless it is listed here.
 */
const FEE_EDITABLE_STATUSES: readonly string[] = ["draft", "published"];

/** Whether a competition in `status` may still have its fees changed. */
export function feeEditAllowed(status: string): boolean {
  return FEE_EDITABLE_STATUSES.includes(status);
}

/** One offered route's fee, as the public page and the edit form show it. */
export type FeeLine =
  | { route: ParticipationRoute; kind: "free" }
  | { route: ParticipationRoute; kind: "amount"; paise: bigint }
  | { route: ParticipationRoute; kind: "not_set" };

/**
 * The fee for every route the competition offers, in route order. A stored
 * fee for a route it no longer offers is left out; an offered route with no
 * stored fee is "not set" (registration on it must wait).
 */
export function feeView(
  participation: Participation | null,
  stored: Fees
): FeeLine[] {
  return offeredRoutes(participation).map((route): FeeLine => {
    const paise = stored[route];
    if (paise === undefined) return { route, kind: "not_set" };
    if (paise === 0n) return { route, kind: "free" };
    return { route, kind: "amount", paise };
  });
}

/** Paise as audit text: JSON has no bigint. */
type AuditAmounts = Partial<Record<ParticipationRoute, string | null>>;

/**
 * The routes whose fee changes between `before` and `after`, each with its
 * old and new amount (null where there is none), or null when nothing
 * changes. This is what the audit log records.
 */
export function feeChanges(
  before: Fees,
  after: Fees
): { before: AuditAmounts; after: AuditAmounts } | null {
  const changed = PARTICIPATION_ROUTES.filter(
    (route) => before[route] !== after[route]
  );
  if (changed.length === 0) return null;
  const amounts = (fees: Fees): AuditAmounts =>
    Object.fromEntries(
      changed.map((route) => [route, fees[route]?.toString() ?? null])
    );
  return { before: amounts(before), after: amounts(after) };
}
