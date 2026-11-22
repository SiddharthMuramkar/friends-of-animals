// What the lead's report page says after a step (#116). Each form posts to
// a Server Action, which runs the use case and sends the lead back to the
// report with the outcome in the address (`?result=moved&status=triaged`,
// `?error=not_found`), so the page works without JavaScript and a reload
// never repeats the step. The page reads only keys it knows, so a crafted
// link can't put words on it. Pure, so the mapping is tested without a page.

import { APP_ROUTES } from "@/lib/app-routes";
import type {
  AddIncidentLogEntryResult,
  AssignSafeguardingReportResult,
  MoveSafeguardingReportResult,
  SafeguardingReportStatus,
} from "@/server/modules/safeguarding";

const STATUSES: readonly SafeguardingReportStatus[] = [
  "new",
  "triaged",
  "investigating",
  "escalated",
  "resolved",
];

const RESULT_KEYS = ["moved", "assigned", "unchanged", "noted"] as const;
const ERROR_KEYS = [
  "invalid_input",
  "transition_not_allowed",
  "report_resolved",
  "assignee_not_lead",
  "not_found",
] as const;

export type LeadResultKey = (typeof RESULT_KEYS)[number];
export type LeadErrorKey = (typeof ERROR_KEYS)[number];

export type LeadOutcome =
  | { kind: "result"; key: "moved"; status: SafeguardingReportStatus }
  | { kind: "result"; key: Exclude<LeadResultKey, "moved"> }
  | { kind: "error"; key: LeadErrorKey };

export function outcomeOfMove(
  result: MoveSafeguardingReportResult
): LeadOutcome {
  return result.ok
    ? { kind: "result", key: "moved", status: result.status }
    : { kind: "error", key: result.error };
}

export function outcomeOfAssign(
  result: AssignSafeguardingReportResult
): LeadOutcome {
  if (!result.ok) return { kind: "error", key: result.error };
  return { kind: "result", key: result.changed ? "assigned" : "unchanged" };
}

export function outcomeOfNote(result: AddIncidentLogEntryResult): LeadOutcome {
  return result.ok
    ? { kind: "result", key: "noted" }
    : { kind: "error", key: result.error };
}

/** The report page's path. */
export function reportHref(reportId: string): string {
  return `${APP_ROUTES.adminSafeguarding}/${encodeURIComponent(reportId)}`;
}

/** The report page with `outcome` in its address. */
export function outcomeHref(reportId: string, outcome: LeadOutcome): string {
  const query = new URLSearchParams(
    outcome.kind === "error"
      ? { error: outcome.key }
      : outcome.key === "moved"
        ? { result: outcome.key, status: outcome.status }
        : { result: outcome.key }
  );
  return `${reportHref(reportId)}?${query}`;
}

function isOneOf<T extends string>(
  list: readonly T[],
  value: unknown
): value is T {
  return (
    typeof value === "string" && (list as readonly string[]).includes(value)
  );
}

/** The outcome in a report page's search params, if it wrote one. */
export function outcomeFromSearch(
  params: Record<string, string | string[] | undefined>
): LeadOutcome | null {
  const { result, error, status } = params;
  if (isOneOf(ERROR_KEYS, error)) return { kind: "error", key: error };
  if (!isOneOf(RESULT_KEYS, result)) return null;
  if (result !== "moved") return { kind: "result", key: result };
  return isOneOf(STATUSES, status)
    ? { kind: "result", key: "moved", status }
    : null;
}
