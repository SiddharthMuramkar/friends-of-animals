// can(actor, action): the one place that decides who may run a use case.
// Every identity use case calls `authorize` first. It denies by default:
// an action without a rule here is refused. #59 replaces the inside with
// scoped roles; the call sites stay.

import type { Actor } from "../actor";
import { DomainError } from "../errors";

export type IdentityAction =
  | "requestEmailCode"
  | "verifyEmailCode"
  | "getAccount"
  | "listSessions"
  | "signOutSession"
  | "signOutEverywhere";

export function can(actor: Actor, action: IdentityAction): boolean {
  switch (action) {
    case "requestEmailCode":
    case "verifyEmailCode":
      // Signing up and signing in are for people who aren't signed in.
      return actor.kind === "visitor";
    case "getAccount":
    case "listSessions":
    case "signOutSession":
    case "signOutEverywhere":
      // A signed-in user, for their own account and sessions only. Most of
      // these take no id; signOutSession takes a session id, and its query
      // matches only the actor's own sessions (session.user_id), so
      // another user's session is "not found".
      return actor.kind === "user";
    default:
      // Deny by default: an action without a rule is no one's.
      return false;
  }
}

export function authorize(actor: Actor, action: IdentityAction): void {
  if (!can(actor, action)) {
    throw new DomainError("forbidden", `${actor.kind} may not ${action}`);
  }
}
