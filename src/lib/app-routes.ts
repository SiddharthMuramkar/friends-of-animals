import { CMS_DOCUMENT_KEYS } from "../server/modules/cms/domain/documents";

/**
 * Pages behind sign-in. They are never in navigation for visitors, the
 * sitemap or search results (each sets robots noindex), and they render at
 * request time. Public pages are in ./routes.ts. src/proxy.ts answers any
 * other path under SIGNED_IN_PREFIXES with the 404, so list every page:
 * here, or in APP_ROUTE_TEMPLATES if its path has a dynamic segment.
 */
export const APP_ROUTES = {
  accountSessions: "/account/sessions",
  accountInbox: "/account/inbox",
  accountNotifications: "/account/notifications",
  accountSecurity: "/account/security",
  dashboard: "/dashboard",
  adminRoles: "/admin/roles",
  adminAudit: "/admin/audit",
  secondFactor: "/auth/second-factor",
  stepUp: "/auth/step-up",
  /** The file upload demo (#63): every environment but production. */
  accountFiles: "/account/files",
  adminSettings: "/admin/settings",
  accountConsents: "/account/consents",
  adminConsentDocuments: "/admin/consent-documents",
  adminConsentForms: "/admin/consent-forms",
  adminCompetitions: "/admin/competitions",
  adminNewCompetition: "/admin/competitions/new",
  adminCms: "/admin/cms",
  adminTemplates: "/admin/templates",
  institutionRegister: "/institutions/register",
  myInstitution: "/institution",
  adminInstitutions: "/admin/institutions",
  institutionCoordinators: "/institution/coordinators",
  adminInbox: "/admin/inbox",
  adminSafeguarding: "/admin/safeguarding",
  adminBlog: "/admin/blog",
  adminNewBlogPost: "/admin/blog/new",
  institutionCompetitions: "/institution/competitions",
  /** The participant dashboard (#78): an adult's own registrations. */
  participant: "/participant",
  /** A guardian's children (#81), and where they declare and verify. */
  guardian: "/guardian",
  guardianRegister: "/guardian/register",
  guardianNewChild: "/guardian/children/new",
} as const;

/** One child's page, for the guardian who looks after them (#81). */
export function guardianChildPath(childId: string): string {
  return `/guardian/children/${encodeURIComponent(childId)}`;
}

export function guardianChildConsentsPath(childId: string): string {
  return `${guardianChildPath(childId)}/consents`;
}

/** A competition's judging guide, for the institutions taking part (#88). */
export function judgingGuidePath(competitionCode: string): string {
  return `/institution/competitions/${encodeURIComponent(competitionCode)}/judging-guide`;
}

/**
 * Payments needing review (#79): finance, staff admins, super admins.
 * Listed with APP_ROUTE_TEMPLATES rather than in APP_ROUTES: the header
 * ships APP_ROUTES to every page, and /contact sits at the JS budget
 * (SPEC §13.2).
 */
export const ADMIN_PAYMENTS_REVIEW = "/admin/payments/review";

/** One payment batch in the admin area (#79): record an offline payment. */
export function adminPaymentBatchPath(batchId: string): string {
  return `/admin/payments/batches/${encodeURIComponent(batchId)}`;
}

/** One payment needing review in the admin area (#79). */
export function adminPaymentReviewCasePath(caseId: string): string {
  return `${ADMIN_PAYMENTS_REVIEW}/${encodeURIComponent(caseId)}`;
}

/**
 * Refunds (#80): the finance queue and each refund's page. Listed with
 * APP_ROUTE_TEMPLATES rather than in APP_ROUTES, like the payments pages.
 */
export const ADMIN_REFUNDS = "/admin/refunds";

export const ADMIN_LEDGER = "/admin/ledger";
export const ADMIN_LEDGER_ACCOUNTS = `${ADMIN_LEDGER}/accounts`;
export const ADMIN_NEW_LEDGER_ENTRY = `${ADMIN_LEDGER}/entries/new`;

export function adminLedgerPostingPath(seq: bigint | string): string {
  return `${ADMIN_LEDGER}/${encodeURIComponent(String(seq))}`;
}

/**
 * A participant's entries (#85): their list, the form for a registration's
 * first upload, and each entry's page by its Entry ID.
 */
export const PARTICIPANT_ENTRIES = "/participant/entries";
export const NEW_PARTICIPANT_ENTRY = "/participant/entries/new";

export function entryDetailPath(code: string): string {
  return `${PARTICIPANT_ENTRIES}/${encodeURIComponent(code)}`;
}

export function newEntryPath(registrationId: string): string {
  const query = new URLSearchParams({ registration: registrationId });
  return `${NEW_PARTICIPANT_ENTRY}?${query.toString()}`;
}

/** One refund's page: finance approves, rejects, retries or records it. */
export function adminRefundPath(refundId: string): string {
  return `${ADMIN_REFUNDS}/${encodeURIComponent(refundId)}`;
}

/** The breach log and its staff-only detail pages (#116). */
export const ADMIN_BREACHES = "/admin/breaches";

export function adminBreachPath(breachId: string): string {
  return `${ADMIN_BREACHES}/${encodeURIComponent(breachId)}`;
}

/** Where a competition manager or staff admin asks for a batch's refund. */
export function adminBatchRefundPath(batchId: string): string {
  return `${adminPaymentBatchPath(batchId)}/refund`;
}

/** One institution's page in the admin area. */
export function adminInstitutionPath(institutionId: string): string {
  return `${APP_ROUTES.adminInstitutions}/${encodeURIComponent(institutionId)}`;
}

/** One signed form in the staff review queue. */
export function adminConsentFormPath(formId: string): string {
  return `${APP_ROUTES.adminConsentForms}/${encodeURIComponent(formId)}`;
}

/** One post's editor in the admin area (#112). */
export function adminBlogPostPath(postId: string): string {
  return `${APP_ROUTES.adminBlog}/${encodeURIComponent(postId)}`;
}

/**
 * The competitions one institution can register for (#75), for its
 * coordinators and its authorised person.
 */
export function institutionCompetitionsPath(institutionId: string): string {
  const query = new URLSearchParams({ institution: institutionId });
  return `${APP_ROUTES.institutionCompetitions}?${query.toString()}`;
}

/**
 * One institution registration's students (#75): the coordinator
 * dashboard, for the institution the user acts for.
 */
export function institutionRegistrationPath(
  reference: string,
  institutionId: string
): string {
  const query = new URLSearchParams({ institution: institutionId });
  return `/institution/registrations/${encodeURIComponent(reference)}?${query.toString()}`;
}

/** A school's consent dashboard, behind sign-in. */
export function studentConsentsPath(
  reference: string,
  institutionId: string
): string {
  const query = new URLSearchParams({ institution: institutionId });
  return `/institution/registrations/${encodeURIComponent(reference)}/consents?${query.toString()}`;
}

/** Where a coordinator adds a student to a registration (#75). */
export function newStudentPath(
  reference: string,
  institutionId: string
): string {
  const query = new URLSearchParams({ institution: institutionId });
  return `/institution/registrations/${encodeURIComponent(reference)}/students/new?${query.toString()}`;
}

const INDIVIDUAL_REGISTER_PREFIX = `${APP_ROUTES.participant}/register/`;

/**
 * Where an adult registers for one competition on their own (#78). It
 * takes their date of birth, phone and address, so it lives in the
 * signed-in tree, under the nonce policy.
 */
export function individualRegisterPath(competitionSlug: string): string {
  return `${INDIVIDUAL_REGISTER_PREFIX}${encodeURIComponent(competitionSlug)}`;
}

/**
 * The competition slug in an individual register form's path, as sent
 * (still percent-encoded), or null for any other path. src/proxy.ts checks
 * it before the page renders, so an unknown or draft competition gets the
 * 404 status, not a 200 page saying not found.
 */
export function individualRegisterSlug(pathname: string): string | null {
  if (!pathname.startsWith(INDIVIDUAL_REGISTER_PREFIX)) return null;
  const slug = pathname.slice(INDIVIDUAL_REGISTER_PREFIX.length);
  return slug === "" || slug.includes("/") ? null : slug;
}

/** An adult's own pay page (#78), as a route template. */
export const PAY_MY_REGISTRATION_ROUTE = "/participant/registrations/[id]/pay";

/** Where an adult pays for their own registration (#78). */
export function payMyRegistrationPath(registrationId: string): string {
  return `${APP_ROUTES.participant}/registrations/${encodeURIComponent(registrationId)}/pay`;
}

/** Where a coordinator pays their students' fees (#77). */
export const PAY_FEES_ROUTE = "/institution/registrations/[ref]/pay";

/**
 * The pages with the Checkout island (#77): a school's pay page and an
 * adult's own (#78). Razorpay's origins and its headers come with these
 * documents only (./csp-sources.ts, ./security-headers.ts).
 */
export const CHECKOUT_ROUTES = [
  PAY_FEES_ROUTE,
  PAY_MY_REGISTRATION_ROUTE,
] as const;

/** A payment batch's status and receipt (#77). */
export const PAYMENT_BATCH_ROUTE =
  "/institution/registrations/[ref]/payments/[batchId]";

/** The pay page of one institution registration (#77). */
export function payFeesPath(reference: string, institutionId: string): string {
  const query = new URLSearchParams({ institution: institutionId });
  return `/institution/registrations/${encodeURIComponent(reference)}/pay?${query.toString()}`;
}

/** One payment batch's status and receipt (#77). */
export function paymentBatchPath(
  reference: string,
  batchId: string,
  institutionId: string
): string {
  const query = new URLSearchParams({ institution: institutionId });
  return `/institution/registrations/${encodeURIComponent(reference)}/payments/${encodeURIComponent(batchId)}?${query.toString()}`;
}

/**
 * Importing students from a CSV file into one institution registration
 * (#76), for the institution the user acts for.
 */
export function studentImportPath(
  reference: string,
  institutionId: string
): string {
  const query = new URLSearchParams({ institution: institutionId });
  return `/institution/registrations/${encodeURIComponent(reference)}/import?${query.toString()}`;
}

/**
 * The import's blank template, or (outside production) its sample file
 * (#76): private downloads, for whoever may import.
 */
export function studentImportFilePath(
  reference: string,
  institutionId: string,
  file: "template.csv" | "sample.csv"
): string {
  const query = new URLSearchParams({ institution: institutionId });
  return `/institution/registrations/${encodeURIComponent(reference)}/import/${file}?${query.toString()}`;
}

/**
 * Pages behind sign-in whose path has a dynamic segment, written as in the
 * app directory: each `[name]` stands for one path segment.
 */
export const APP_ROUTE_TEMPLATES = [
  "/admin/consent-forms/[id]",
  "/admin/competitions/[id]/edit",
  "/admin/competitions/[id]/preview",
  "/admin/competitions/[id]/terms",
  "/admin/competitions/[id]/announcements",
  "/admin/competitions/[id]/announcements/new",
  "/admin/competitions/[id]/announcements/[announcementId]",
  "/admin/templates/[key]",
  "/admin/institutions/[id]",
  "/admin/inbox/[id]",
  "/admin/safeguarding/[id]",
  "/admin/blog/[id]",
  "/admin/competitions/[id]/rubrics",
  "/admin/competitions/[id]/rubrics/[discipline]",
  ADMIN_PAYMENTS_REVIEW,
  "/admin/payments/batches/[id]",
  "/admin/payments/review/[id]",
  ADMIN_REFUNDS,
  "/admin/refunds/[id]",
  ADMIN_BREACHES,
  "/admin/breaches/[id]",
  "/admin/payments/batches/[id]/refund",
  ADMIN_LEDGER,
  ADMIN_LEDGER_ACCOUNTS,
  ADMIN_NEW_LEDGER_ENTRY,
  "/admin/ledger/[seq]",
  "/institution/competitions/[code]/judging-guide",
  "/institution/registrations/[ref]",
  "/institution/registrations/[ref]/consents",
  "/institution/registrations/[ref]/students/new",
  "/institution/registrations/[ref]/import",
  "/institution/registrations/[ref]/import/template.csv",
  "/institution/registrations/[ref]/import/sample.csv",
  "/participant/register/[slug]",
  PARTICIPANT_ENTRIES,
  NEW_PARTICIPANT_ENTRY,
  "/participant/entries/[code]",
  "/guardian/children/[id]",
  "/guardian/children/[id]/consents",
  "/guardian/children/[id]/consents/history",
  PAY_MY_REGISTRATION_ROUTE,
  PAY_FEES_ROUTE,
  PAYMENT_BATCH_ROUTE,
] as const;

/**
 * Where coordinator (#74) and teen-login (#81) invitations' pages live.
 * Each path carries its link token, the bearer credential, so analytics
 * leaves the whole prefix out (src/lib/analytics/umami.ts).
 */
export const INVITATIONS_PREFIX = "/invitations";

/**
 * An invitation's page, a coordinator's or a teen's. Anyone holding the
 * link can open it (it is the bearer of the invitation), so it is not
 * behind sign-in.
 */
export function invitationPath(token: string): string {
  return `${INVITATIONS_PREFIX}/${encodeURIComponent(token)}`;
}

/**
 * Path prefixes that need a signed-in user. src/proxy.ts sends visitors
 * without a session cookie to sign in; #65's CSP gives these a nonce.
 * Each tree also needs the proxy's matcher to list it, and a layout that
 * waits for the request (src/app/account/layout.tsx), so it has no static
 * shell.
 */
export const SIGNED_IN_PREFIXES = [
  "/account",
  "/admin",
  "/auth",
  "/dashboard",
  "/institution",
  "/institutions/register",
  "/participant",
  "/guardian",
] as const;

export function isSignedInPath(pathname: string): boolean {
  return isUnderPrefix(pathname, SIGNED_IN_PREFIXES);
}

/**
 * True when `pathname` is one of `prefixes` or below one, by whole
 * segments: "/account/x" is under "/account", "/accounts" isn't.
 */
export function isUnderPrefix(
  pathname: string,
  prefixes: readonly string[]
): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function fitsTemplate(pathname: string, template: string): boolean {
  const segments = pathname.split("/");
  const parts = template.split("/");
  return (
    segments.length === parts.length &&
    parts.every((part, i) =>
      /^\[\w+\]$/.test(part) ? segments[i] !== "" : part === segments[i]
    )
  );
}

/** Whether `pathname` is a page in APP_ROUTES, APP_ROUTE_TEMPLATES or one CMS editor. */
export function isSignedInPage(pathname: string): boolean {
  return (
    (Object.values(APP_ROUTES) as string[]).includes(pathname) ||
    APP_ROUTE_TEMPLATES.some((template) => fitsTemplate(pathname, template)) ||
    isCmsEditorPath(pathname)
  );
}

/**
 * One editor page per CMS document (#111), and no other path below it.
 * Worked out on each call, not held in a module-level Set: the client
 * bundles this module for isSignedInPath, and a Set built at load would
 * ship to every page (the JS budget, SPEC §13.2).
 */
function isCmsEditorPath(pathname: string): boolean {
  return CMS_DOCUMENT_KEYS.some(
    (key) => adminCmsDocumentPath(key) === pathname
  );
}

/** The editor page of one CMS document (#111). */
export function adminCmsDocumentPath(key: string): `/admin/cms/${string}` {
  return `/admin/cms/${key}`;
}

/**
 * Pages that exist everywhere but production: src/proxy.ts answers 404
 * for them there, before anything renders.
 */
export const NON_PRODUCTION_PREFIXES = [APP_ROUTES.accountFiles] as const;

export function isNonProductionPath(pathname: string): boolean {
  return NON_PRODUCTION_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export const CONSENT_LINK_PREFIX = "/consent";

export function consentLinkPath(token: string): string {
  return `${CONSENT_LINK_PREFIX}/${encodeURIComponent(token)}`;
}

export function isConsentLinkPage(pathname: string): boolean {
  return fitsTemplate(pathname, `${CONSENT_LINK_PREFIX}/[token]`);
}
