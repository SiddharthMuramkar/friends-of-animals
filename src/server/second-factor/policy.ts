// Who may run the second-factor use cases (#60). Each user manages their
// own factors; there is no id to name another user's, except a super
// admin's reset. Loads under plain Node: relative imports only.

import { signedIn, type Policy } from "../access/domain/policy";

export const SECOND_FACTOR_POLICY = {
  /** Their own factors and whether this session has passed one. */
  "second-factor.view-own": signedIn,
  /**
   * Adding an authenticator app or a passkey. Once one exists, another
   * also needs a fresh second factor; the use case checks that, since it
   * depends on what the user already holds.
   */
  "second-factor.enrol": signedIn,
  /** Passing a second factor for this session. */
  "second-factor.verify": signedIn,
} satisfies Policy<string>;

export type SecondFactorAction = keyof typeof SECOND_FACTOR_POLICY;
