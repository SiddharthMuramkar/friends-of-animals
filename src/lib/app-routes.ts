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
  accountAuctions: "/account/auctions",
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
  adminGallery: "/admin/gallery",
  adminGalleryReports: "/admin/gallery/reports",
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

/** The staff data inventory (#114). */
export const ADMIN_PRIVACY = "/admin/privacy";

/** The grievance officer's queue of privacy requests (#115). */
export const ADMIN_PRIVACY_REQUESTS = "/admin/privacy/requests";

/** One privacy request, for the grievance officer (#115). */
export function adminPrivacyRequestPath(requestId: string): string {
  return `${ADMIN_PRIVACY_REQUESTS}/${encodeURIComponent(requestId)}`;
}

/** A user's own privacy requests, and where they make one (#115). */
export const MY_PRIVACY_REQUESTS = "/dashboard/privacy";
export const NEW_PRIVACY_REQUEST = "/dashboard/privacy/new";

/** One of a user's privacy requests (#115). */
export function myPrivacyRequestPath(requestId: string): string {
  return `${MY_PRIVACY_REQUESTS}/${encodeURIComponent(requestId)}`;
}

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
export const ADMIN_AUCTION_PROCEEDS = `${ADMIN_LEDGER}/auction-proceeds`;
export const ADMIN_LEDGER_ACCOUNTS = `${ADMIN_LEDGER}/accounts`;
export const ADMIN_NEW_LEDGER_ENTRY = `${ADMIN_LEDGER}/entries/new`;
/** Period lock, two-approver requests, budgets and the accountant's export (#109). */
export const ADMIN_LEDGER_PERIODS = `${ADMIN_LEDGER}/periods`;
export const ADMIN_LEDGER_APPROVALS = `${ADMIN_LEDGER}/approvals`;
export const ADMIN_LEDGER_BUDGETS = `${ADMIN_LEDGER}/budgets`;
export const ADMIN_LEDGER_BUDGET_REPORT = `${ADMIN_LEDGER_BUDGETS}/report`;
export const ADMIN_LEDGER_EXPORT = `${ADMIN_LEDGER}/export`;
export const ADMIN_LEDGER_EXPORT_CSV = `${ADMIN_LEDGER}/export.csv`;

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

/** Finance's donations (#106): the list and each donation's page. */
export const ADMIN_DONATIONS = "/admin/donations";
export const ADMIN_OFFLINE_DONATION = `${ADMIN_DONATIONS}/offline` as const;
export const ADMIN_RECURRING_DONATIONS = "/admin/donations/recurring";
export const DASHBOARD_DONATIONS = "/dashboard/donations";
export const MONTHLY_CHECKOUT_ROUTE = "/donate/checkout/monthly/[id]";
export const recurringDonationPath = (id: string) =>
  `${DASHBOARD_DONATIONS}/recurring/${encodeURIComponent(id)}`;
export const monthlyCheckoutPath = (id: string) =>
  `/donate/checkout/monthly/${encodeURIComponent(id)}`;

export function adminDonationPath(donationId: string): string {
  return `${ADMIN_DONATIONS}/${encodeURIComponent(donationId)}`;
}

/**
 * Volunteering (#123): a member's application, a guardian's view of their
 * teen's, and the community team's queue. Listed with APP_ROUTE_TEMPLATES
 * rather than in APP_ROUTES, like the payments pages.
 */
export const DASHBOARD_COMMUNITY = "/dashboard/community";
export const DASHBOARD_TIMELINE = "/dashboard/timeline";
export const ADMIN_COMMUNITY_MEMBERS = "/admin/community/members";
export function guardianChildTimelinePath(childId: string): string {
  return `${guardianChildPath(childId)}/timeline`;
}

export const DASHBOARD_VOLUNTEER = "/dashboard/volunteer";
export const ADMIN_VOLUNTEERS = "/admin/volunteers";

export function adminVolunteerApplicationPath(applicationId: string): string {
  return `${ADMIN_VOLUNTEERS}/${encodeURIComponent(applicationId)}`;
}

export function guardianChildVolunteerPath(childId: string): string {
  return `${guardianChildPath(childId)}/volunteer`;
}

/** The breach log and its staff-only detail pages (#116). */
export const ADMIN_BREACHES = "/admin/breaches";

export function adminBreachPath(breachId: string): string {
  return `${ADMIN_BREACHES}/${encodeURIComponent(breachId)}`;
}

/**
 * The NGO directory (#127): registering a listing, the listings a person
 * acts for, and the staff review queue. Listed with APP_ROUTE_TEMPLATES
 * rather than in APP_ROUTES, like the payments pages. The public listing
 * page, /ngos/<slug>, is outside the signed-in tree.
 */
export const NGO_REGISTER = "/ngos/register";
export const MY_LISTINGS = "/organisation";
export const ADMIN_DIRECTORY = "/admin/directory";

/** One listing the signed-in user acts for. */
export function myListingPath(listingId: string): string {
  return `${MY_LISTINGS}/${encodeURIComponent(listingId)}`;
}

/** Where the listing's people edit it. */
export function editListingPath(listingId: string): string {
  return `${myListingPath(listingId)}/edit`;
}

/** One listing in the staff review queue. */
export function adminDirectoryListingPath(listingId: string): string {
  return `${ADMIN_DIRECTORY}/${encodeURIComponent(listingId)}`;
}

/** A verified listing's public page. */
export function publicListingPath(slug: string): string {
  return `/ngos/${encodeURIComponent(slug)}`;
}

/**
 * A directory listing's animals for adoption (#129), managed by its
 * representatives. Listed with APP_ROUTE_TEMPLATES. The public pages,
 * /adopt and /adopt/<slug>, are in src/lib/routes.ts.
 */
export function adoptionsPath(listingId: string): string {
  return `${myListingPath(listingId)}/adoptions`;
}

/** Where a representative adds an animal. */
export function newAdoptionPath(listingId: string): string {
  return `${adoptionsPath(listingId)}/new`;
}

/** One animal's photos, publishing and details. */
export function adoptionPath(listingId: string, adoptionId: string): string {
  return `${adoptionsPath(listingId)}/${encodeURIComponent(adoptionId)}`;
}

/** Where a representative edits an animal's details. */
export function editAdoptionPath(
  listingId: string,
  adoptionId: string
): string {
  return `${adoptionPath(listingId, adoptionId)}/edit`;
}

/** An animal's applications, for its organisation (#130). */
export function adoptionApplicationsPath(
  listingId: string,
  adoptionId: string
): string {
  return `${adoptionPath(listingId, adoptionId)}/applications`;
}

/**
 * Adoption applications (#130): an applicant's own, where they apply, and
 * the adoption coordinator's queue. Listed with APP_ROUTE_TEMPLATES. The
 * public stories page, /adopt/stories, is in src/lib/routes.ts.
 */
export const DASHBOARD_ADOPTIONS = "/dashboard/adoptions";
export const ADMIN_JUDGING_ROUNDS = "/admin/judging/rounds";
export const JUDGE_DASHBOARD = "/judge";
export const JUDGE_INVITATIONS_PREFIX = "/judge/invitations";
export const adminJudgingRoundPath = (id: string) =>
  `${ADMIN_JUDGING_ROUNDS}/${encodeURIComponent(id)}`;
export const judgeInvitationPath = (token: string) =>
  `${JUDGE_INVITATIONS_PREFIX}/${encodeURIComponent(token)}`;
export const judgeRoundPath = (id: string) =>
  `${JUDGE_DASHBOARD}/rounds/${encodeURIComponent(id)}`;
export const judgeEntryPath = (id: string, entryCode: string) =>
  `${judgeRoundPath(id)}/entries/${encodeURIComponent(entryCode)}`;
export const judgeOnboardingPath = (id: string) =>
  `${JUDGE_DASHBOARD}/rounds/${encodeURIComponent(id)}/onboarding`;
export const isJudgeInvitationPage = (path: string) =>
  fitsTemplate(path, `${JUDGE_INVITATIONS_PREFIX}/[token]`);

/** Public request-time verification, never signed in or cached. */
export const CERTIFICATE_VERIFY_PREFIX = "/verify";
export const GALLERY_REPORT_PREFIX = "/gallery-report";
export const ADMIN_CERTIFICATES = "/admin/certificates";
export const MY_CERTIFICATES = "/dashboard/certificates";
export const ADMIN_ARTWORK = "/admin/artwork";
export const ADMIN_ARTWORK_DISCREPANCIES = "/admin/artwork/discrepancies";
export const INSTITUTION_ARTWORK = "/institution/artwork";
export const MY_ARTWORK = "/dashboard/artwork";
export const adminArtworkPath = (artworkCode: string) =>
  `${ADMIN_ARTWORK}/${encodeURIComponent(artworkCode)}`;

export const adminArtworkVerifyPath = (artworkCode: string) =>
  `${adminArtworkPath(artworkCode)}/verify`;

export const ADMIN_VERIFICATION = "/admin/verification";
export function adminVerificationEntryPath(entryId: string): string {
  return `${ADMIN_VERIFICATION}/${encodeURIComponent(entryId)}`;
}

export const ADMIN_AUCTIONS = "/admin/auctions";
export const ADMIN_AUCTIONS_NEW = "/admin/auctions/lots/new";
export const adminAuctionLotPath = (lotId: string) =>
  `${ADMIN_AUCTIONS}/lots/${encodeURIComponent(lotId)}`;
export const auctionLotPath = (lotCode: string) =>
  `/auctions/${encodeURIComponent(lotCode)}`;
export const ADMIN_ADOPTIONS = "/admin/adoptions";

export function myAdoptionApplicationPath(applicationId: string): string {
  return `${DASHBOARD_ADOPTIONS}/${encodeURIComponent(applicationId)}`;
}

export function applyToAdoptPath(slug: string): string {
  return `${DASHBOARD_ADOPTIONS}/apply/${encodeURIComponent(slug)}`;
}

export function adminAdoptionApplicationPath(applicationId: string): string {
  return `${ADMIN_ADOPTIONS}/${encodeURIComponent(applicationId)}`;
}

/**
 * Adopters' success stories (#130), public. Kept out of src/lib/routes.ts:
 * its ROUTES ship to every page's browser code, and /awareness sits at the
 * JS budget. The sitemap lists it by hand.
 */
export const ADOPTION_STORIES_PATH = "/adopt/stories";

/** Published ledger figures (#110); kept out of the shared client registry. */
export const TRANSPARENCY_PATH = "/transparency";
export function transparencyYearPath(fy: string): string {
  return `${TRANSPARENCY_PATH}?fy=${encodeURIComponent(fy)}`;
}

/** An adoptable animal's public page. */
export function adoptableAnimalPath(slug: string): string {
  return `/adopt/${encodeURIComponent(slug)}`;
}

/** Campaigns to consented segments (#126): the list, the composer, each one. */
export const ADMIN_CAMPAIGNS = "/admin/campaigns";
export const ADMIN_NEW_CAMPAIGN = `${ADMIN_CAMPAIGNS}/new`;

export function adminCampaignPath(campaignId: string): string {
  return `${ADMIN_CAMPAIGNS}/${encodeURIComponent(campaignId)}`;
}

/** Where a competition manager or staff admin asks for a batch's refund. */
export function adminBatchRefundPath(batchId: string): string {
  return `${adminPaymentBatchPath(batchId)}/refund`;
}

/**
 * Where a super admin cancels a competition (#80). Listed with
 * APP_ROUTE_TEMPLATES rather than in APP_ROUTES, like the payments pages.
 */
export function adminSchoolRoundsPath(competitionId: string): string {
  return `/admin/competitions/${encodeURIComponent(competitionId)}/school-rounds`;
}

export function adminCompetitionResultsPath(competitionId: string): string {
  return `/admin/competitions/${encodeURIComponent(competitionId)}/results`;
}

export function adminCompetitionCancelPath(competitionId: string): string {
  return `/admin/competitions/${encodeURIComponent(competitionId)}/cancel`;
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

/** A registration's submission roster: every student's entry (#87). */
export function institutionSubmissionsPath(
  reference: string,
  institutionId: string
): string {
  const query = new URLSearchParams({ institution: institutionId });
  return `/institution/registrations/${encodeURIComponent(reference)}/submissions?${query.toString()}`;
}

/** One student's entry, where their coordinator uploads it (#87). */
export function studentSubmissionPath(
  reference: string,
  registrationNumber: string,
  institutionId: string
): string {
  const query = new URLSearchParams({ institution: institutionId });
  return `/institution/registrations/${encodeURIComponent(reference)}/submissions/${encodeURIComponent(registrationNumber)}?${query.toString()}`;
}

/** Where a coordinator certifies the competition's conduct (#87). */
/** A registration's school round page (#89), for the institution acting. */
export function schoolRoundPath(
  reference: string,
  institutionId: string
): string {
  const query = new URLSearchParams({ institution: institutionId });
  return `/institution/registrations/${encodeURIComponent(reference)}/school-round?${query.toString()}`;
}

export function conductCertificationPath(
  reference: string,
  institutionId: string
): string {
  const query = new URLSearchParams({ institution: institutionId });
  return `/institution/registrations/${encodeURIComponent(reference)}/conduct?${query.toString()}`;
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
 * A donation's checkout (#106): a bearer page for whoever holds the
 * donation's checkout token, signed in or not. src/proxy.ts gives it the
 * nonce policy, like a consent link, without the sign-in check.
 */
export const DONATION_CHECKOUT_PREFIX = "/donate/checkout";
export const DONATION_CHECKOUT_ROUTE = `${DONATION_CHECKOUT_PREFIX}/[donationId]`;

export function donationCheckoutPath(donationId: string, token: string) {
  const query = new URLSearchParams({ t: token });
  return `${DONATION_CHECKOUT_PREFIX}/${encodeURIComponent(donationId)}?${query.toString()}`;
}

export function isDonationCheckoutPage(pathname: string): boolean {
  return (
    fitsTemplate(pathname, DONATION_CHECKOUT_ROUTE) ||
    fitsTemplate(pathname, MONTHLY_CHECKOUT_ROUTE)
  );
}

/** A donation's thank-you page (#106), for the same token's holder. */
export const DONATION_THANK_YOU = "/donate/thank-you";

export function donationThankYouPath(donationId: string, token: string) {
  const query = new URLSearchParams({ d: donationId, t: token });
  return `${DONATION_THANK_YOU}?${query.toString()}`;
}

/**
 * Receipts (#106): a receipt behind its 7-day link, and the form that
 * emails the donor a new link. Never cached, indexed or sent as a referrer.
 */
export const RECEIPTS_PREFIX = "/receipts";
export const RECEIPT_REQUEST = `${RECEIPTS_PREFIX}/request`;

export function receiptPath(token: string): string {
  return `${RECEIPTS_PREFIX}/${encodeURIComponent(token)}`;
}

/**
 * The pages with the Checkout island (#77): a school's pay page, an
 * adult's own (#78) and a donation's checkout (#106). Razorpay's origins
 * and its headers come with these documents only (./csp-sources.ts,
 * ./security-headers.ts).
 */
export const AUCTION_CHECKOUT_ROUTE = "/account/auctions/[lotCode]";
export const CHECKOUT_ROUTES = [
  AUCTION_CHECKOUT_ROUTE,
  PAY_FEES_ROUTE,
  PAY_MY_REGISTRATION_ROUTE,
  DONATION_CHECKOUT_ROUTE,
  MONTHLY_CHECKOUT_ROUTE,
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
  ADMIN_JUDGING_ROUNDS,
  "/admin/judging/rounds/new",
  "/admin/judging/rounds/[id]",
  "/admin/judging/rounds/[id]/judges",
  "/admin/judging/rounds/[id]/pool",
  "/admin/judging/rounds/[id]/assignments",
  "/admin/judging/rounds/[id]/conflicts",
  "/admin/judging/rounds/[id]/rankings",
  JUDGE_DASHBOARD,
  "/judge/rounds/[id]/onboarding",
  "/judge/rounds/[id]",
  "/judge/rounds/[id]/entries/[entryCode]",

  ADMIN_CERTIFICATES,
  MY_CERTIFICATES,
  ADMIN_ARTWORK,
  "/admin/artwork/[artworkCode]",
  "/admin/artwork/[artworkCode]/verify",
  ADMIN_ARTWORK_DISCREPANCIES,
  INSTITUTION_ARTWORK,
  MY_ARTWORK,
  ADMIN_VERIFICATION,
  "/admin/verification/[id]",
  "/admin/consent-forms/[id]",
  "/admin/competitions/[id]/edit",
  "/admin/competitions/[id]/results",
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
  "/admin/competitions/[id]/school-rounds",
  "/admin/competitions/[id]/rubrics/[discipline]",
  ADMIN_PAYMENTS_REVIEW,
  ADMIN_PRIVACY,
  ADMIN_PRIVACY_REQUESTS,
  "/admin/privacy/requests/[id]",
  MY_PRIVACY_REQUESTS,
  NEW_PRIVACY_REQUEST,
  "/dashboard/privacy/[id]",
  "/admin/payments/batches/[id]",
  "/admin/payments/review/[id]",
  ADMIN_REFUNDS,
  "/admin/refunds/[id]",
  ADMIN_BREACHES,
  "/admin/breaches/[id]",
  ADMIN_DONATIONS,
  ADMIN_OFFLINE_DONATION,
  ADMIN_RECURRING_DONATIONS,
  "/admin/donations/[id]",
  DASHBOARD_DONATIONS,
  "/dashboard/donations/recurring/[id]",
  ADMIN_CAMPAIGNS,
  ADMIN_NEW_CAMPAIGN,
  "/admin/campaigns/[id]",
  "/admin/payments/batches/[id]/refund",
  ADMIN_LEDGER,
  ADMIN_AUCTION_PROCEEDS,
  ADMIN_LEDGER_ACCOUNTS,
  ADMIN_NEW_LEDGER_ENTRY,
  ADMIN_LEDGER_PERIODS,
  ADMIN_LEDGER_APPROVALS,
  ADMIN_LEDGER_BUDGETS,
  ADMIN_LEDGER_BUDGET_REPORT,
  ADMIN_LEDGER_EXPORT,
  ADMIN_LEDGER_EXPORT_CSV,
  "/admin/ledger/[seq]",
  "/admin/competitions/[id]/cancel",
  "/institution/competitions/[code]/judging-guide",
  "/institution/registrations/[ref]",
  "/institution/registrations/[ref]/consents",
  "/institution/registrations/[ref]/submissions",
  "/institution/registrations/[ref]/submissions/[number]",
  "/institution/registrations/[ref]/conduct",
  "/institution/registrations/[ref]/school-round",
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
  "/guardian/children/[id]/volunteer",
  DASHBOARD_COMMUNITY,
  DASHBOARD_TIMELINE,
  ADMIN_COMMUNITY_MEMBERS,
  "/guardian/children/[id]/timeline",
  DASHBOARD_VOLUNTEER,
  ADMIN_VOLUNTEERS,
  "/admin/volunteers/[id]",
  PAY_MY_REGISTRATION_ROUTE,
  PAY_FEES_ROUTE,
  PAYMENT_BATCH_ROUTE,
  AUCTION_CHECKOUT_ROUTE,
  NGO_REGISTER,
  MY_LISTINGS,
  "/organisation/[id]",
  "/organisation/[id]/edit",
  ADMIN_DIRECTORY,
  "/admin/directory/[id]",
  "/organisation/[id]/adoptions",
  "/organisation/[id]/adoptions/new",
  "/organisation/[id]/adoptions/[adoptionId]",
  "/organisation/[id]/adoptions/[adoptionId]/edit",
  "/organisation/[id]/adoptions/[adoptionId]/applications",
  "/dashboard/adoptions",
  "/dashboard/adoptions/[id]",
  "/dashboard/adoptions/apply/[slug]",
  ADMIN_AUCTIONS,
  ADMIN_AUCTIONS_NEW,
  "/admin/auctions/lots/[lotId]",
  "/admin/adoptions",
  "/admin/adoptions/[id]",
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
 * Where a campaign message's withdrawal link opens (#126). The path carries
 * its token, the bearer credential, so analytics leaves the prefix out
 * (src/lib/analytics/umami.ts). Anyone holding the link can open it.
 */
export const WITHDRAWAL_PREFIX = "/withdraw";

export function withdrawalPath(token: string): string {
  return `${WITHDRAWAL_PREFIX}/${encodeURIComponent(token)}`;
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
  "/ngos/register",
  "/organisation",
  JUDGE_DASHBOARD,
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
