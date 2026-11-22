// Why accepting a guardian request failed, as the invitation page reads it
// back from the address bar (81b): only reasons acceptGuardianRequest
// returns are shown.

import type { AcceptGuardianRequestResult } from "@/server/modules/guardians";

export type RequestAcceptError = Extract<
  AcceptGuardianRequestResult,
  { ok: false }
>["error"];

const REQUEST_ACCEPT_ERRORS: readonly RequestAcceptError[] = [
  "not_found",
  "already_used",
  "withdrawn",
  "expired",
  "requester_cannot_accept",
  "contact_mismatch",
  "accepter_is_minor",
  "guardian_not_verified",
  "child_already_added",
  "already_linked",
  "requester_is_adult",
  "requester_has_role",
  "invalid_input",
];

export function isRequestAcceptError(
  value: unknown
): value is RequestAcceptError {
  return REQUEST_ACCEPT_ERRORS.includes(value as RequestAcceptError);
}
