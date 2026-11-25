// What the school round page says after a coordinator saves the panel or
// a shortlist, or finalises (#89), from the use case's result or the error
// it threw. A shortlist's problems travel in the address after the
// redirect, so the page can name each one. Pure, so the mapping is tested
// without a page; the page translates the keys.

import { DomainError } from "@/server/errors";
import type {
  FinaliseSchoolRoundResult,
  PickProblem,
  RecordPanelResult,
  SaveShortlistResult,
} from "@/server/modules/school-round";

export const ROUND_OUTCOMES = [
  "panel_saved",
  "shortlist_saved",
  "finalised",
  "panel_empty",
  "panel_too_large",
  "invalid_input",
  "shortlist_invalid",
  "unknown_category",
  "finalise_blocked",
  "shortlist_only",
  "round_not_editable",
  "not_open",
  "not_found",
  "forbidden",
  "failed",
] as const;

export type RoundOutcome = (typeof ROUND_OUTCOMES)[number];

const SUCCESS: readonly RoundOutcome[] = [
  "panel_saved",
  "shortlist_saved",
  "finalised",
];

export function isRoundOutcome(value: unknown): value is RoundOutcome {
  return (ROUND_OUTCOMES as readonly unknown[]).includes(value);
}

export function isSuccess(outcome: RoundOutcome): boolean {
  return SUCCESS.includes(outcome);
}

type Result =
  | RecordPanelResult
  | SaveShortlistResult
  | FinaliseSchoolRoundResult;

/** The outcome of a call that returned; `saved` names its success. */
export function roundOutcome(
  result: Result,
  saved: "panel_saved" | "shortlist_saved" | "finalised"
): RoundOutcome {
  return result.ok ? saved : result.error;
}

/** The outcome of one that threw: refused, or anything else. */
export function roundError(error: unknown): RoundOutcome {
  return error instanceof DomainError && error.code === "forbidden"
    ? "forbidden"
    : "failed";
}

/** A shortlist's problems as one query value. */
export function encodeProblems(problems: readonly PickProblem[]): string {
  return problems
    .map((problem) => {
      switch (problem.code) {
        case "shortlist_full":
          return `${problem.code}~${problem.count}~${problem.limit}`;
        case "position_out_of_range":
          return `${problem.code}~${problem.entryId}~${problem.limit}`;
        default:
          return `${problem.code}~${problem.entryId}`;
      }
    })
    .join(",");
}

/** A problem as the page names it. */
export type ShownProblem = {
  code: PickProblem["code"];
  entryId: string | null;
  count: number | null;
  limit: number | null;
};

const CODES: readonly PickProblem["code"][] = [
  "unknown_entry",
  "wrong_category",
  "not_submitted",
  "duplicate_entry",
  "shortlist_full",
  "position_out_of_range",
  "position_taken",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = /^\d{1,4}$/;

/** The problems in a query value; anything malformed is left out. */
export function decodeProblems(value: unknown): ShownProblem[] {
  if (typeof value !== "string" || value.length > 2000) return [];
  return value.split(",").flatMap((part): ShownProblem[] => {
    const [code, a, b] = part.split("~");
    if (!CODES.includes(code as PickProblem["code"])) return [];
    const known = code as PickProblem["code"];
    if (known === "shortlist_full") {
      return a && b && NUMBER.test(a) && NUMBER.test(b)
        ? [{ code: known, entryId: null, count: Number(a), limit: Number(b) }]
        : [];
    }
    if (!a || !UUID.test(a)) return [];
    if (known === "position_out_of_range") {
      return b && NUMBER.test(b)
        ? [{ code: known, entryId: a, count: null, limit: Number(b) }]
        : [];
    }
    return [{ code: known, entryId: a, count: null, limit: null }];
  });
}
