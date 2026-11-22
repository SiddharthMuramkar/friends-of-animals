// Who may run the guardians module's use cases (#81): their rules in the
// platform policy (src/server/access/policies.ts).
//
// Any signed-in member may declare themselves a guardian and verify it by
// code. Verifying grants the global `guardian` role, which managing
// children needs; acting on one child also needs an active guardian_link
// between the acting guardian and that child, which the use case reports
// as the resource's owner (./child-access.ts). A teen with a linked login
// holds no guardian role, so they can't add siblings or invite anyone:
// accepting a teen login refuses a guardian's account, and declaring as a
// guardian refuses a linked login.
//
// Loads under plain Node: relative imports only, no "server-only".

import {
  anyOf,
  owner,
  role,
  signedIn,
  signedOut,
  type Decision,
  type Policy,
  type Rule,
} from "../../access/domain/policy";

const REFUSED: Decision = { allowed: false };

/**
 * A guardian (the role) acting on a child they are linked to: the use case
 * names the acting user as the child's owner only when an active link
 * joins them.
 */
const guardianOfChild: Rule = (subject, resource) => {
  const held = role("guardian")(subject, resource);
  return held.allowed && owner(subject, resource).allowed ? held : REFUSED;
};

export const GUARDIANS_POLICY = {
  // Declaring, and verifying by code: for themselves only.
  "guardian.register": signedIn,
  // Adding children and listing them: verified guardians.
  "guardian.children.manage": role("guardian"),
  // One child's page, inviting them to a login, withdrawing the invite.
  "guardian.child.manage": guardianOfChild,
  // The link is the credential for reading what it invites to.
  "guardian.invitation.view": anyOf(signedOut, signedIn),
  // Accepting needs an account: the use case then checks it is the one
  // invited.
  "guardian.invitation.accept": signedIn,
  // A teen's own guardians.
  "guardian.mine.list": signedIn,
} satisfies Policy<string>;
