// Why a teen's accept failed, as the invitation page reads it back from the
// address bar (#81): only reasons acceptTeenInvitation returns are shown.

import type { AcceptTeenInvitationResult } from "@/server/modules/guardians";

export type TeenAcceptError = Extract<
  AcceptTeenInvitationResult,
  { ok: false }
>["error"];

const TEEN_ACCEPT_ERRORS: readonly TeenAcceptError[] = [
  "not_found",
  "already_used",
  "withdrawn",
  "expired",
  "guardian_cannot_accept",
  "contact_mismatch",
  "already_linked",
  "child_has_login",
  "under_13",
  "adult",
];

export function isTeenAcceptError(value: unknown): value is TeenAcceptError {
  return TEEN_ACCEPT_ERRORS.includes(value as TeenAcceptError);
}
