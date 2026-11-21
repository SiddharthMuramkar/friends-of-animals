// Who may run the identity use cases: their rules in the platform policy
// (src/server/access/policies.ts). Every identity use case awaits
// `authorize` from src/server/access/can.ts first, like every other use
// case, and an action without a rule is refused.

import {
  anyOf,
  signedIn,
  signedOut,
  type Policy,
} from "../access/domain/policy";

export const IDENTITY_POLICY = {
  // Signing up and signing in are for people who aren't signed in.
  requestEmailCode: signedOut,
  verifyEmailCode: signedOut,
  requestPhoneCode: signedOut,
  verifyPhoneCode: signedOut,
  // Which ways in are on is no secret: the sign-in pages ask for whoever
  // is looking at them.
  signInMethods: anyOf(signedOut, signedIn),
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
