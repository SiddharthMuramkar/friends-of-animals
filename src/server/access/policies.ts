// The platform's policy: one rule per action, from every module. A module
// with use cases keeps its rules next to them and adds one argument here;
// an action defined twice fails type-checking. Each rule names its roles;
// super admin is not a wildcard.

import { CMS_POLICY } from "../modules/cms/policy";
import { IDENTITY_POLICY } from "../identity/policy";
import { FILES_POLICY } from "../modules/files/policy";
import { CONSENT_LINKS_POLICY } from "../modules/consent-links/policy";
import { CONSENT_POLICY } from "../modules/consent/policy";
import { CONSENT_FORMS_POLICY } from "../modules/consent-forms/policy";
import { COMPETITIONS_POLICY } from "../modules/competitions/policy";
import { NOTIFICATIONS_POLICY } from "../modules/notifications/policy";
import { SECOND_FACTOR_POLICY } from "../modules/second-factor/policy";
import { SETTINGS_POLICY } from "../modules/settings/policy";
import { INSTITUTIONS_POLICY } from "../modules/institutions/policy";
import { COORDINATORS_POLICY } from "../modules/institutions/coordinators/policy";
import { CONTACT_POLICY } from "../modules/contact/access-policy";
import { PUBLIC_FORMS_POLICY } from "../modules/public-forms/access-policy";
import { SAFEGUARDING_POLICY } from "../modules/safeguarding/policy";
import { JUDGING_POLICY } from "../modules/judging/policy";
import { COMPETITION_TERMS_POLICY } from "../modules/competitions/terms/policy";
import { PAYMENTS_POLICY } from "../modules/payments/policy";
import { PARTICIPANTS_POLICY } from "../modules/participants/policy";
import { GUARDIANS_POLICY } from "../modules/guardians/policy";
import { LEDGER_POLICY } from "../modules/ledger/policy";
import { ENTRIES_POLICY } from "../modules/entries/policy";
import { ANNOUNCEMENTS_POLICY } from "../modules/announcements/policy";
import { PRIVACY_POLICY } from "../modules/privacy/policy";
import { PRIVACY_REQUESTS_POLICY } from "../modules/privacy/requests/policy";
import { BREACHES_POLICY } from "../modules/breaches/policy";
import { INSTITUTION_SUBMISSIONS_POLICY } from "../modules/institution-submissions/policy";
import { DIRECTORY_POLICY } from "../modules/directory/policy";
import { ADOPTION_POLICY } from "../modules/adoption/policy";
import { VOLUNTEERS_POLICY } from "../modules/volunteers/policy";
import { REMINDERS_POLICY } from "../modules/reminders/policy";
import { CAMPAIGNS_POLICY } from "../modules/campaigns/policy";
import { ACCESS_POLICY } from "./domain/access-policy";
import { composePolicies } from "./domain/policy";

export const POLICY = composePolicies(
  IDENTITY_POLICY,
  ACCESS_POLICY,
  SECOND_FACTOR_POLICY,
  FILES_POLICY,
  SETTINGS_POLICY,
  CONSENT_POLICY,
  CONSENT_FORMS_POLICY,
  CONSENT_LINKS_POLICY,
  COMPETITIONS_POLICY,
  CMS_POLICY,
  NOTIFICATIONS_POLICY,
  INSTITUTIONS_POLICY,
  COORDINATORS_POLICY,
  PUBLIC_FORMS_POLICY,
  CONTACT_POLICY,
  SAFEGUARDING_POLICY,
  JUDGING_POLICY,
  COMPETITION_TERMS_POLICY,
  PAYMENTS_POLICY,
  PARTICIPANTS_POLICY,
  GUARDIANS_POLICY,
  LEDGER_POLICY,
  ENTRIES_POLICY,
  ANNOUNCEMENTS_POLICY,
  PRIVACY_POLICY,
  BREACHES_POLICY,
  PRIVACY_REQUESTS_POLICY,
  DIRECTORY_POLICY,
  ADOPTION_POLICY,
  VOLUNTEERS_POLICY,
  REMINDERS_POLICY,
  CAMPAIGNS_POLICY,
  INSTITUTION_SUBMISSIONS_POLICY
);

export type Action = keyof typeof POLICY;
