// Who may run the identity use cases. Every one of them calls `authorize`
// first. The rules are part of the platform policy (src/server/access/
// policies.ts), which denies by default: an action without a rule is
// refused.
//
// None of these rules needs a role, so the check here is synchronous and
// reads no grants. A rule that needs a role belongs with the use cases of
// another module, behind the async `authorize` in src/server/access/can.ts.

import {
  decide,
  signedIn,
  signedOut,
  type Policy,
  type Subject,
} from "../access/domain/policy";
import type { Actor } from "../actor";
import { DomainError } from "../errors";

export const IDENTITY_POLICY = {
  // Signing up and signing in are for people who aren't signed in.
  requestEmailCode: signedOut,
  verifyEmailCode: signedOut,
  // A signed-in user, for their own account and sessions only. Most of
  // these take no id; signOutSession takes a session id, and its query
  // matches only the actor's own sessions (session.user_id), so another
  // user's session is "not found".
  getAccount: signedIn,
  listSessions: signedIn,
  signOutSession: signedIn,
  signOutEverywhere: signedIn,
} satisfies Policy<string>;

export type IdentityAction = keyof typeof IDENTITY_POLICY;

/** The actor as the policy sees it; these rules never look at grants. */
function subjectOf(actor: Actor): Subject {
  switch (actor.kind) {
    case "visitor":
      return { kind: "visitor" };
    case "system":
      return { kind: "system", process: actor.process };
    case "user":
      return { kind: "user", userId: actor.userId, grants: [] };
  }
}

export function can(actor: Actor, action: IdentityAction): boolean {
  return decide(IDENTITY_POLICY, subjectOf(actor), action).allowed;
}

export function authorize(actor: Actor, action: IdentityAction): void {
  if (!can(actor, action)) {
    throw new DomainError("forbidden", `${actor.kind} may not ${action}`);
  }
}
