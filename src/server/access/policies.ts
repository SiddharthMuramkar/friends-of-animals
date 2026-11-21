// The platform's policy: one rule per action, from every module. A module
// with use cases keeps its rules next to them and adds one argument here;
// an action defined twice fails type-checking. Each rule names its roles;
// super admin is not a wildcard.

import { CONSENT_POLICY } from "../consent/policy";
import { IDENTITY_POLICY } from "../identity/policy";
import { SAFEGUARDING_POLICY } from "../modules/safeguarding/policy";
import { NOTIFICATIONS_POLICY } from "../notifications/policy";
import { SETTINGS_POLICY } from "../settings/policy";
import { CONTACT_POLICY } from "../modules/contact/access-policy";
import { PUBLIC_FORMS_POLICY } from "../modules/public-forms/access-policy";
import { ACCESS_POLICY } from "./domain/access-policy";
import { composePolicies } from "./domain/policy";

export const POLICY = composePolicies(
  IDENTITY_POLICY,
  ACCESS_POLICY,
  CONSENT_POLICY,
  SETTINGS_POLICY,
  PUBLIC_FORMS_POLICY,
  CONTACT_POLICY,
  NOTIFICATIONS_POLICY,
  SAFEGUARDING_POLICY
);

export type Action = keyof typeof POLICY;
