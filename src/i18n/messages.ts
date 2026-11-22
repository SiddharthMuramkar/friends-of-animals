// Every namespace file, imported statically so the merged messages are typed
// and bundled at build time. One file per namespace: each agent edits its own.
// Adding a namespace: create messages/en-IN/<name>.json ({ "<name>": {} }),
// import it here and add it to NAMESPACES and `messages`.
import a11y from "../../messages/en-IN/a11y.json";
import about from "../../messages/en-IN/about.json";
import account from "../../messages/en-IN/account.json";
import adminSettings from "../../messages/en-IN/adminSettings.json";
import admin from "../../messages/en-IN/admin.json";
import adminAudit from "../../messages/en-IN/adminAudit.json";
import adminTemplates from "../../messages/en-IN/adminTemplates.json";
import adminRoles from "../../messages/en-IN/adminRoles.json";
import adminCompetitions from "../../messages/en-IN/adminCompetitions.json";
import adminCms from "../../messages/en-IN/adminCms.json";
import adminInstitutions from "../../messages/en-IN/adminInstitutions.json";
import auth from "../../messages/en-IN/auth.json";
import authPhone from "../../messages/en-IN/authPhone.json";
import awareness from "../../messages/en-IN/awareness.json";
import common from "../../messages/en-IN/common.json";
import competitions from "../../messages/en-IN/competitions.json";
import consent from "../../messages/en-IN/consent.json";
import consentAdmin from "../../messages/en-IN/consentAdmin.json";
import competitionStatus from "../../messages/en-IN/competitionStatus.json";
import contact from "../../messages/en-IN/contact.json";
import credits from "../../messages/en-IN/credits.json";
import dashboard from "../../messages/en-IN/dashboard.json";
import donate from "../../messages/en-IN/donate.json";
import error from "../../messages/en-IN/error.json";
import files from "../../messages/en-IN/files.json";
import footer from "../../messages/en-IN/footer.json";
import home from "../../messages/en-IN/home.json";
import impact from "../../messages/en-IN/impact.json";
import inbox from "../../messages/en-IN/inbox.json";
import institutions from "../../messages/en-IN/institutions.json";
import legal from "../../messages/en-IN/legal.json";
import nav from "../../messages/en-IN/nav.json";
import notFound from "../../messages/en-IN/notFound.json";
import notificationSettings from "../../messages/en-IN/notificationSettings.json";
import pricing from "../../messages/en-IN/pricing.json";
import refunds from "../../messages/en-IN/refunds.json";
import sample from "../../messages/en-IN/sample.json";
import schools from "../../messages/en-IN/schools.json";
import security from "../../messages/en-IN/security.json";
import showcase from "../../messages/en-IN/showcase.json";
import stories from "../../messages/en-IN/stories.json";
import styleguide from "../../messages/en-IN/styleguide.json";

export const NAMESPACES = [
  "a11y",
  "about",
  "account",
  "adminSettings",
  "admin",
  "adminAudit",
  "adminTemplates",
  "adminRoles",
  "adminCompetitions",
  "adminCms",
  "adminInstitutions",
  "auth",
  "authPhone",
  "awareness",
  "common",
  "competitions",
  "consent",
  "consentAdmin",
  "competitionStatus",
  "contact",
  "credits",
  "dashboard",
  "donate",
  "error",
  "files",
  "footer",
  "home",
  "impact",
  "inbox",
  "institutions",
  "legal",
  "nav",
  "notFound",
  "notificationSettings",
  "pricing",
  "refunds",
  "sample",
  "schools",
  "security",
  "showcase",
  "stories",
  "styleguide",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/** en-IN messages, merged: { common: {...}, nav: {...}, ... }. */
export const messages = {
  ...a11y,
  ...about,
  ...account,
  ...adminSettings,
  ...admin,
  ...adminAudit,
  ...adminTemplates,
  ...adminRoles,
  ...adminCompetitions,
  ...adminCms,
  ...adminInstitutions,
  ...auth,
  ...authPhone,
  ...awareness,
  ...common,
  ...competitions,
  ...consent,
  ...consentAdmin,
  ...competitionStatus,
  ...contact,
  ...credits,
  ...dashboard,
  ...donate,
  ...error,
  ...files,
  ...footer,
  ...home,
  ...impact,
  ...inbox,
  ...institutions,
  ...legal,
  ...nav,
  ...notFound,
  ...notificationSettings,
  ...pricing,
  ...refunds,
  ...sample,
  ...schools,
  ...security,
  ...showcase,
  ...stories,
  ...styleguide,
};

export type Messages = typeof messages;
