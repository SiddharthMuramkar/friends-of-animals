// Who may run the consent use cases (#64). Publishing a consent document
// and reading its history is for staff admins and super admins with a
// global grant (FOA confirms the list: HR-17). The current version of a
// document is public: the legal pages and the sign-up form show it. Each
// signed-in user gives, withdraws and reads their own consent only: the
// use cases take no user id, so there is no way to name another.
//
// Loads under plain Node: relative imports only.

import {
  role,
  signedIn,
  type Policy,
  type Rule,
} from "../access/domain/policy";

/** Allows everyone, signed in or not. */
const anyone: Rule = () => ({ allowed: true, role: null });

export const CONSENT_POLICY = {
  "consent_document.publish": role("staff_admin", "super_admin"),
  "consent_document.list_versions": role("staff_admin", "super_admin"),
  "consent_document.view_current": anyone,
  "consent.give": signedIn,
  "consent.withdraw": signedIn,
  "consent.view_own": signedIn,
} satisfies Policy<string>;

export type ConsentAction = keyof typeof CONSENT_POLICY;
