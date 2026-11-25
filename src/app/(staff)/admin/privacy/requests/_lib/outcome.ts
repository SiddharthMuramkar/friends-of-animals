// What the grievance officer's request page says after a step (#115). Each
// form posts to a Server Action, which runs the use case and sends the
// officer back with the outcome in the address (`?result=started`,
// `?error=plan_changed`), so the page works without JavaScript and a
// reload never repeats a step. The page reads only keys it knows. Pure.

import { adminPrivacyRequestPath } from "@/lib/app-routes";

export const OFFICER_RESULTS = [
  "started",
  "assigned",
  "unchanged",
  "noted",
  "rejected",
  "completed",
  "export",
  "erasure",
] as const;

export const OFFICER_ERRORS = [
  "invalid_input",
  "not_found",
  "request_closed",
  "already_started",
  "already_in_progress",
  "not_started",
  "not_erasure",
  "assignee_not_officer",
  "completed_by_export_or_erasure",
  "not_access",
  "already_requested",
  "erasure_disabled",
  "plan_changed",
  "already_approved",
] as const;

export type OfficerResult = (typeof OFFICER_RESULTS)[number];
export type OfficerError = (typeof OFFICER_ERRORS)[number];
export type OfficerOutcome =
  | { kind: "result"; key: OfficerResult }
  | { kind: "error"; key: OfficerError };

function isOneOf<T extends string>(
  list: readonly T[],
  value: unknown
): value is T {
  return (
    typeof value === "string" && (list as readonly string[]).includes(value)
  );
}

/** A use case's result as an outcome: `ok` becomes `success`. */
export function outcomeOf(
  result: { ok: true } | { ok: false; error: string },
  success: OfficerResult
): OfficerOutcome {
  if (result.ok) return { kind: "result", key: success };
  return isOneOf(OFFICER_ERRORS, result.error)
    ? { kind: "error", key: result.error }
    : { kind: "error", key: "invalid_input" };
}

/** The request page with `outcome` in its address. */
export function outcomeHref(
  requestId: string,
  outcome: OfficerOutcome
): string {
  const query = new URLSearchParams(
    outcome.kind === "error" ? { error: outcome.key } : { result: outcome.key }
  );
  return `${adminPrivacyRequestPath(requestId)}?${query}`;
}

/** The outcome in the request page's address, if it wrote one. */
export function outcomeFromSearch(
  params: Record<string, string | string[] | undefined>
): OfficerOutcome | null {
  if (isOneOf(OFFICER_ERRORS, params.error)) {
    return { kind: "error", key: params.error };
  }
  if (isOneOf(OFFICER_RESULTS, params.result)) {
    return { kind: "result", key: params.result };
  }
  return null;
}
