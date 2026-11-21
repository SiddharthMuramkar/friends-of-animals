// Who may run the second-factor use cases (#60). Each user manages their
// own factors; there is no id to name another user's, except a super
// admin's reset. Loads under plain Node: relative imports only.

import {
  role,
  signedIn,
  stepUp,
  type Policy,
} from "../../access/domain/policy";

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
  /** Whether staff screens may open; anyone signed in may ask. */
  "second-factor.staff-access": signedIn,
  /** Removing one of their own factors, after a fresh second factor. */
  "second-factor.remove": stepUp(signedIn),
  /**
   * Clearing someone's factors when they lost them all (HR-19's recovery
   * default): a super admin, after a fresh second factor.
   */
  "second-factor.reset": stepUp(role("super_admin")),
} satisfies Policy<string>;

export type SecondFactorAction = keyof typeof SECOND_FACTOR_POLICY;
