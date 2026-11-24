// Every namespace file, imported statically so the merged messages are typed
// and bundled at build time. One file per namespace: each agent edits its own.
// Adding a namespace: create messages/en-IN/<name>.json ({ "<name>": {} }),
// import it here and add it to NAMESPACES and `messages`.
import a11y from "../../messages/en-IN/a11y.json";
import about from "../../messages/en-IN/about.json";
import account from "../../messages/en-IN/account.json";
import adminInbox from "../../messages/en-IN/adminInbox.json";
import adminSettings from "../../messages/en-IN/adminSettings.json";
import admin from "../../messages/en-IN/admin.json";
import adminAudit from "../../messages/en-IN/adminAudit.json";
import adminTemplates from "../../messages/en-IN/adminTemplates.json";
import adminRoles from "../../messages/en-IN/adminRoles.json";
import adminCompetitions from "../../messages/en-IN/adminCompetitions.json";
import adminCms from "../../messages/en-IN/adminCms.json";
import adminBlog from "../../messages/en-IN/adminBlog.json";
import adminInstitutions from "../../messages/en-IN/adminInstitutions.json";
import adminSafeguarding from "../../messages/en-IN/adminSafeguarding.json";
import adminPrivacy from "../../messages/en-IN/adminPrivacy.json";
import adminRubrics from "../../messages/en-IN/adminRubrics.json";
import adminCompetitionTerms from "../../messages/en-IN/adminCompetitionTerms.json";
import adminPayments from "../../messages/en-IN/adminPayments.json";
import adminRefunds from "../../messages/en-IN/adminRefunds.json";
import adminLedger from "../../messages/en-IN/adminLedger.json";
import adminConsentForms from "../../messages/en-IN/adminConsentForms.json";
import adminAnnouncements from "../../messages/en-IN/adminAnnouncements.json";
import art from "../../messages/en-IN/art.json";
import adminBreaches from "../../messages/en-IN/adminBreaches.json";
import adminDirectory from "../../messages/en-IN/adminDirectory.json";
import adminVolunteers from "../../messages/en-IN/adminVolunteers.json";
import campaigns from "../../messages/en-IN/campaigns.json";
import auth from "../../messages/en-IN/auth.json";
import authPhone from "../../messages/en-IN/authPhone.json";
import awareness from "../../messages/en-IN/awareness.json";
import childConsents from "../../messages/en-IN/childConsents.json";
import common from "../../messages/en-IN/common.json";
import competitions from "../../messages/en-IN/competitions.json";
import competitionTerms from "../../messages/en-IN/competitionTerms.json";
import consent from "../../messages/en-IN/consent.json";
import consentAdmin from "../../messages/en-IN/consentAdmin.json";
import competitionStatus from "../../messages/en-IN/competitionStatus.json";
import competitionCancel from "../../messages/en-IN/competitionCancel.json";
import contact from "../../messages/en-IN/contact.json";
import coordinatorConsents from "../../messages/en-IN/coordinatorConsents.json";
import guardianConsent from "../../messages/en-IN/guardianConsent.json";
import guardianConsentDelivery from "../../messages/en-IN/guardianConsentDelivery.json";
import coordinators from "../../messages/en-IN/coordinators.json";
import contactForm from "../../messages/en-IN/contactForm.json";
import credits from "../../messages/en-IN/credits.json";
import dashboard from "../../messages/en-IN/dashboard.json";
import directory from "../../messages/en-IN/directory.json";
import donate from "../../messages/en-IN/donate.json";
import donationCheckout from "../../messages/en-IN/donationCheckout.json";
import donations from "../../messages/en-IN/donations.json";
import receipts from "../../messages/en-IN/receipts.json";
import adminDonations from "../../messages/en-IN/adminDonations.json";
import entries from "../../messages/en-IN/entries.json";
import error from "../../messages/en-IN/error.json";
import files from "../../messages/en-IN/files.json";
import footer from "../../messages/en-IN/footer.json";
import guardian from "../../messages/en-IN/guardian.json";
import volunteer from "../../messages/en-IN/volunteer.json";
import home from "../../messages/en-IN/home.json";
import impact from "../../messages/en-IN/impact.json";
import inbox from "../../messages/en-IN/inbox.json";
import institutions from "../../messages/en-IN/institutions.json";
import judgingGuide from "../../messages/en-IN/judgingGuide.json";
import institutionRegistration from "../../messages/en-IN/institutionRegistration.json";
import legal from "../../messages/en-IN/legal.json";
import nav from "../../messages/en-IN/nav.json";
import notFound from "../../messages/en-IN/notFound.json";
import notificationSettings from "../../messages/en-IN/notificationSettings.json";
import participant from "../../messages/en-IN/participant.json";
import payments from "../../messages/en-IN/payments.json";
import pricing from "../../messages/en-IN/pricing.json";
import refunds from "../../messages/en-IN/refunds.json";
import safeguardingReport from "../../messages/en-IN/safeguardingReport.json";
import registration from "../../messages/en-IN/registration.json";
import sample from "../../messages/en-IN/sample.json";
import schools from "../../messages/en-IN/schools.json";
import security from "../../messages/en-IN/security.json";
import showcase from "../../messages/en-IN/showcase.json";
import stories from "../../messages/en-IN/stories.json";
import styleguide from "../../messages/en-IN/styleguide.json";
import studentImport from "../../messages/en-IN/studentImport.json";

export const NAMESPACES = [
  "a11y",
  "about",
  "account",
  "adminInbox",
  "adminSettings",
  "admin",
  "adminAudit",
  "adminTemplates",
  "adminRoles",
  "adminCompetitions",
  "adminCms",
  "adminInstitutions",
  "adminSafeguarding",
  "adminPrivacy",
  "adminBlog",
  "adminRubrics",
  "adminCompetitionTerms",
  "adminPayments",
  "adminConsentForms",
  "adminRefunds",
  "adminLedger",
  "adminAnnouncements",
  "art",
  "adminBreaches",
  "adminDirectory",
  "adminVolunteers",
  "campaigns",
  "auth",
  "authPhone",
  "awareness",
  "childConsents",
  "common",
  "competitions",
  "competitionTerms",
  "consent",
  "consentAdmin",
  "competitionStatus",
  "competitionCancel",
  "contact",
  "coordinators",
  "coordinatorConsents",
  "guardianConsent",
  "guardianConsentDelivery",
  "contactForm",
  "credits",
  "dashboard",
  "directory",
  "donate",
  "donationCheckout",
  "donations",
  "receipts",
  "adminDonations",
  "entries",
  "error",
  "files",
  "footer",
  "guardian",
  "volunteer",
  "home",
  "impact",
  "inbox",
  "institutions",
  "judgingGuide",
  "institutionRegistration",
  "legal",
  "nav",
  "notFound",
  "notificationSettings",
  "participant",
  "payments",
  "pricing",
  "refunds",
  "safeguardingReport",
  "registration",
  "sample",
  "schools",
  "security",
  "showcase",
  "stories",
  "styleguide",
  "studentImport",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/** en-IN messages, merged: { common: {...}, nav: {...}, ... }. */
export const messages = {
  ...a11y,
  ...about,
  ...account,
  ...adminInbox,
  ...adminSettings,
  ...admin,
  ...adminAudit,
  ...adminTemplates,
  ...adminRoles,
  ...adminCompetitions,
  ...adminCms,
  ...adminInstitutions,
  ...adminSafeguarding,
  ...adminPrivacy,
  ...adminBlog,
  ...adminRubrics,
  ...adminCompetitionTerms,
  ...adminPayments,
  ...adminRefunds,
  ...adminLedger,
  ...adminConsentForms,
  ...adminAnnouncements,
  ...art,
  ...adminBreaches,
  ...adminDirectory,
  ...adminVolunteers,
  ...campaigns,
  ...auth,
  ...authPhone,
  ...awareness,
  ...childConsents,
  ...common,
  ...competitions,
  ...competitionTerms,
  ...consent,
  ...consentAdmin,
  ...competitionStatus,
  ...competitionCancel,
  ...contact,
  ...coordinators,
  ...coordinatorConsents,
  ...guardianConsent,
  ...guardianConsentDelivery,
  ...contactForm,
  ...credits,
  ...dashboard,
  ...directory,
  ...donate,
  ...donationCheckout,
  ...donations,
  ...receipts,
  ...adminDonations,
  ...entries,
  ...error,
  ...files,
  ...footer,
  ...guardian,
  ...volunteer,
  ...home,
  ...impact,
  ...inbox,
  ...institutions,
  ...judgingGuide,
  ...institutionRegistration,
  ...legal,
  ...nav,
  ...notFound,
  ...notificationSettings,
  ...participant,
  ...payments,
  ...pricing,
  ...refunds,
  ...safeguardingReport,
  ...registration,
  ...sample,
  ...schools,
  ...security,
  ...showcase,
  ...stories,
  ...styleguide,
  ...studentImport,
};

export type Messages = typeof messages;
