// What a requester's privacy pages say after a step (#115). Each form posts
// to a Server Action, which runs the use case and sends the browser back
// with the outcome in the address (`?result=filed`, `?error=already_open`),
// so the pages work without JavaScript and a reload never repeats a step.
// The pages read only keys they know, so a crafted link can't put words on
// them. Pure, so the mapping is tested without a page.

import { myPrivacyRequestPath, NEW_PRIVACY_REQUEST } from "@/lib/app-routes";

export const NEW_ERRORS = [
  "invalid_input",
  "already_open",
  "child_is_adult",
  "guardian_not_verified",
  "erasure_needs_guardian",
  "under_13_needs_guardian",
  "forbidden",
] as const;
export type NewRequestError = (typeof NEW_ERRORS)[number];

export const VIEW_RESULTS = ["filed", "cancelled"] as const;
export const VIEW_ERRORS = [
  "already_in_progress",
  "request_closed",
  "export_not_ready",
  "link_expired",
  "export_deleted",
] as const;
export type ViewResult = (typeof VIEW_RESULTS)[number];
export type ViewError = (typeof VIEW_ERRORS)[number];

function isOneOf<T extends string>(
  list: readonly T[],
  value: unknown
): value is T {
  return (
    typeof value === "string" && (list as readonly string[]).includes(value)
  );
}

type Search = Record<string, string | string[] | undefined>;

/** The new-request page with why the request was refused. */
export function newRequestErrorHref(error: NewRequestError): string {
  return `${NEW_PRIVACY_REQUEST}?${new URLSearchParams({ error })}`;
}

/** The refusal in the new-request page's address, if it wrote one. */
export function newRequestErrorFrom(params: Search): NewRequestError | null {
  return isOneOf(NEW_ERRORS, params.error) ? params.error : null;
}

/** A request's page with `outcome` in its address. */
export function viewOutcomeHref(
  requestId: string,
  outcome: { result: ViewResult } | { error: ViewError }
): string {
  return `${myPrivacyRequestPath(requestId)}?${new URLSearchParams(outcome)}`;
}

/** The outcome in a request page's address, if it wrote one. */
export function viewOutcomeFrom(
  params: Search
):
  | { kind: "result"; key: ViewResult }
  | { kind: "error"; key: ViewError }
  | null {
  if (isOneOf(VIEW_ERRORS, params.error)) {
    return { kind: "error", key: params.error };
  }
  if (isOneOf(VIEW_RESULTS, params.result)) {
    return { kind: "result", key: params.result };
  }
  return null;
}
