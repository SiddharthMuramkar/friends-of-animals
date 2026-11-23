// Who may run the consent use cases (#64). Publishing a consent document
// and reading its history is for staff admins and super admins with a
// global grant (FOA confirms the list: HR-17). The current version of a
// document is public: the legal pages and the sign-up form show it. Each
// signed-in user gives, withdraws and reads their own consent only: the
// use cases take no user id, so there is no way to name another.
//
// A child's consents (#82) are their verified guardian's to give, withdraw
// and read: the guardian role (verifying grants it) acting on a child an
// active link joins them to, which the use case reports as the child's
// owner (../guardians/child-access.ts). A teen's own login holds no
// guardian role, so a child never gives their guardian's consent.
//
// Loads under plain Node: relative imports only.

import {
  owner,
  role,
  signedIn,
  type Policy,
  type Rule,
} from "../../access/domain/policy";

/** Allows everyone, signed in or not. */
const anyone: Rule = () => ({ allowed: true, role: null });

/** A verified guardian acting on a child they are linked to. */
const guardianOfChild: Rule = (subject, resource) => {
  const held = role("guardian")(subject, resource);
  return held.allowed && owner(subject, resource).allowed
    ? held
    : { allowed: false };
};

export const CONSENT_POLICY = {
  "consent_document.publish": role("staff_admin", "super_admin"),
  "consent_document.list_versions": role("staff_admin", "super_admin"),
  "consent_document.view_current": anyone,
  "consent.give": signedIn,
  "consent.withdraw": signedIn,
  "consent.view_own": signedIn,
  "consent.child.give": guardianOfChild,
  "consent.child.withdraw": guardianOfChild,
  "consent.child.read": guardianOfChild,
} satisfies Policy<string>;

export type ConsentAction = keyof typeof CONSENT_POLICY;
