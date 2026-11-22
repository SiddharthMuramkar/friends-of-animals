// Why an accept failed, as the invitation page reads it back from the
// address bar: only reasons acceptInvitation returns are shown.

import type { AcceptInvitationResult } from "@/server/modules/institutions/coordinators";

export type AcceptError = Extract<
  AcceptInvitationResult,
  { ok: false }
>["error"];

const ACCEPT_ERRORS: readonly AcceptError[] = [
  "not_found",
  "expired",
  "already_accepted",
  "revoked",
  "identifier_mismatch",
  "institution_not_verified",
];

export function isAcceptError(value: unknown): value is AcceptError {
  return ACCEPT_ERRORS.includes(value as AcceptError);
}
