// Every runtime setting, in the order the settings screen lists them. A
// super admin changes them without a deploy; app code reads them with
// their default applied when nothing is stored.
//
// Keys are `<group>.<name>` in camelCase, so each one is also the path of
// its label and description in messages/en-IN/adminSettings.json. A ticket
// that adds a setting appends it to its group here.
//
// Loads under plain Node (the seed script): no "server-only", no "@/"
// imports.

import { CODE_REQUEST_LIMITS } from "../../identity/settings";
import {
  DEFAULT_APPROVAL_EXPIRY_DAYS,
  DEFAULT_MANUAL_ENTRY_APPROVAL_THRESHOLD_RUPEES,
} from "../ledger/domain/approval";
import {
  CONTACT_RETENTION,
  MAX_RETENTION_DAYS,
  minimumRetentionDays,
  RETENTION_PERIODS,
  type RetentionPeriod,
} from "../privacy/domain/periods";
import { MAX_REMINDER_OFFSET_HOURS } from "../reminders/domain/offsets";
import {
  MIN_ADOPTER_AGE_BOUNDS,
  MIN_ADOPTER_AGE_DEFAULT,
} from "../adoption/domain/application-eligibility";
import {
  VOLUNTEER_AGE_RULE_BOUNDS,
  VOLUNTEER_AGE_RULE_DEFAULTS,
} from "../volunteers/domain/eligibility";
import { RESUBMISSION_DAYS } from "../verification/domain/decide";
import {
  booleanSetting,
  integerSetting,
  type SettingDefinition,
  textSetting,
} from "./definition";

/**
 * A retention policy's period in days (#114): its default, and a minimum
 * the policy's statutory floor sets, so no value can shorten the floor.
 */
function retentionDays(period: RetentionPeriod) {
  return integerSetting({
    default: period.defaultDays,
    min: minimumRetentionDays(period),
    max: MAX_RETENTION_DAYS,
    unit: "days",
  });
}

/**
 * When one reminder goes out (#84): hours before its deadline, up to 30
 * days; 0 sends none. FOA confirms the defaults (HR-37).
 */
function reminderHours(defaultHours: number) {
  return integerSetting({
    default: defaultHours,
    min: 0,
    max: MAX_REMINDER_OFFSET_HOURS,
    unit: "hours",
  });
}

export const SETTINGS = {
  // Identity and access (#60): staff sessions are shorter than members'.
  "auth.staffSessionHours": integerSetting({
    default: 12,
    min: 1,
    max: 24,
    unit: "hours",
  }),
  // Sign-in by emailed code (#57). On by default, but production also
  // needs SES configured and out of its sandbox (src/server/deps.ts,
  // DECISIONS R-27); until then sign-in says it opens soon.
  "auth.emailSignIn": booleanSetting({ default: true }),
  // Messages (#58): off until DLT registration through MSG91 (HR-14).
  // Seeded on for local runs and previews, which capture every text.
  "sms.enabled": booleanSetting({ default: false }),
  // Ceilings on sign-in texts to everyone together, so a pool of networks
  // can't text thousands of numbers on FOA's bill (#58, HR-19).
  "sms.maxPerHour": integerSetting({
    default: CODE_REQUEST_LIMITS.smsPerHour,
    min: 1,
    max: 1000,
    unit: "texts",
  }),
  "sms.maxPerDay": integerSetting({
    default: CODE_REQUEST_LIMITS.smsPerDay,
    min: 1,
    max: 5000,
    unit: "texts",
  }),
  // Organisation facts. Off until FOA holds 80G (HR-16) and is registered
  // under FCRA; they gate tax receipts and foreign donations (M5).
  "org.has80G": booleanSetting({ default: false }),
  "org.fcraEnabled": booleanSetting({ default: false }),
  // FOA's tax and registration facts (#111): they go on receipts, so a
  // super admin sets them. Empty until FOA confirms each one (HR-21); the
  // site shows "To be confirmed" until then, and production leaves it out.
  "org.legalName": textSetting({ default: "", maxLength: 200 }),
  "org.registrationType": textSetting({ default: "", maxLength: 100 }),
  "org.registrationNumber": textSetting({ default: "", maxLength: 50 }),
  "org.pan": textSetting({ default: "", maxLength: 10 }),
  // Donations (#106). Off until Razorpay's live keys (HR-15) and the
  // accountant's chart and receipts (HR-47) are in place: the donate page
  // then says donations open soon, and nothing starts. Seeded on for local
  // runs and previews, which pay through the test checkout. The amounts
  // and the expiry are defaults FOA confirms (HR-51).
  "donations.enabled": booleanSetting({ default: false }),
  "donations.recurringEnabled": booleanSetting({ default: false }),
  // Whether someone without an account may give.
  "donations.allowGuest": booleanSetting({ default: true }),
  "donations.minAmountRupees": integerSetting({
    default: 100,
    min: 1,
    max: 100_000,
    unit: "rupees",
  }),
  "donations.maxAmountRupees": integerSetting({
    default: 100_000,
    min: 1,
    max: 10_000_000,
    unit: "rupees",
  }),
  // How long an online donation waits for Checkout before it expires.
  "donations.pendingExpiryHours": integerSetting({
    default: 24,
    min: 1,
    max: 168,
    unit: "hours",
  }),
  // Safeguarding (#116): concern reports one IP may send in an hour before
  // the form refuses and shows the helplines instead (HR-48).
  "safeguarding.reportsPerIpPerHour": integerSetting({
    default: 10,
    min: 1,
    max: 100,
    unit: "reports",
  }),
  // Breaches (#116): where a breach notice to the authority is emailed.
  // Empty until FOA's counsel names the channel (HR-49); staff then file
  // the notice by hand and record the authority's reference.
  "breach.authorityEmail": textSetting({ default: "", maxLength: 254 }),
  // Ledger (#109). A manual entry moving more than this many rupees waits
  // for a second finance user; 0 sends every manual entry for approval.
  // A request nobody decides expires after the days below (HR-51).
  "ledger.manualEntryApprovalThresholdRupees": integerSetting({
    default: DEFAULT_MANUAL_ENTRY_APPROVAL_THRESHOLD_RUPEES,
    min: 0,
    max: 1_000_000_000,
    unit: "rupees",
  }),
  "ledger.approvalExpiryDays": integerSetting({
    default: DEFAULT_APPROVAL_EXPIRY_DAYS,
    min: 1,
    max: 90,
    unit: "days",
  }),
  // The accountant's ledger export. Off until FOA's accountant confirms its
  // format (HR-47); seeded on for local runs and previews.
  "ledger.accountantExport": booleanSetting({ default: false }),
  // Privacy rights requests (#115): how many days the grievance officer
  // has to answer. Access and correction requests use requestDueDays; an
  // erasure, which withdraws the person's consents, uses erasureDueDays
  // (the withdrawal SLA). Both wait for counsel's DPDP ruling (HR-30).
  "privacy.requestDueDays": integerSetting({
    default: 30,
    min: 1,
    max: 90,
    unit: "days",
  }),
  "privacy.erasureDueDays": integerSetting({
    default: 30,
    min: 1,
    max: 90,
    unit: "days",
  }),
  // How long the requester's download link to their data export works;
  // the export is deleted when it stops (#115b).
  "privacy.exportLinkHours": integerSetting({
    default: 72,
    min: 1,
    max: 168,
    unit: "hours",
  }),
  // Erasing data can't be undone. Off until counsel rules on what erasure
  // must keep (HR-30): the officer can preview an erasure, not run it.
  // Seeded on for local runs and previews.
  "privacy.erasureEnabled": booleanSetting({ default: false }),
  // While a payment the person made is under its 8-year floor, erasure
  // keeps their account (name and contact, nothing else) so the payment
  // still names its payer. Off deletes the account; the payment rows stay
  // either way (HR-30, HR-47).
  "privacy.erasureKeepsPayerAccount": booleanSetting({ default: true }),
  // Volunteers (#123). Applying stays closed until FOA's safeguarding lead
  // and counsel sign M6 off (HR-55) and police checks are in place
  // (HR-38); local runs and previews are seeded open. The age rules are
  // FOA's defaults until leadership confirms them (HR-57).
  "volunteers.applicationsOpen": booleanSetting({ default: false }),
  "volunteers.minAgeYears": integerSetting({
    default: VOLUNTEER_AGE_RULE_DEFAULTS.minAgeYears,
    ...VOLUNTEER_AGE_RULE_BOUNDS.minAgeYears,
    unit: "years",
  }),
  "volunteers.guardianApprovalBelowAgeYears": integerSetting({
    default: VOLUNTEER_AGE_RULE_DEFAULTS.guardianApprovalBelowAgeYears,
    ...VOLUNTEER_AGE_RULE_BOUNDS.guardianApprovalBelowAgeYears,
    unit: "years",
  }),
  // Adoption (#130): only adults adopt. FOA's default until leadership
  // confirms it (HR-62); never below 18.
  "adoption.minAdopterAgeYears": integerSetting({
    default: MIN_ADOPTER_AGE_DEFAULT,
    ...MIN_ADOPTER_AGE_BOUNDS,
    unit: "years",
  }),
  // Reminders (#84): two reminders before submissions close, to whoever
  // still owes an entry. A change applies to each reminder when it runs,
  // and the hourly reminder sync plans any new time.
  "reminders.entrySubmissionDueFirstHours": reminderHours(72),
  "reminders.entrySubmissionDueSecondHours": reminderHours(24),
  "reminders.schoolRoundShortlistDueFirstHours": reminderHours(72),
  "reminders.schoolRoundShortlistDueSecondHours": reminderHours(24),
  // Physical artwork (#93), HR-40: no requests until FOA supplies the address.
  "artwork.dispatchDays": integerSetting({
    default: 14,
    min: 3,
    max: 60,
    unit: "days",
  }),
  "artwork.dispatchReminderLeadHours": reminderHours(72),
  "artwork.packagingInstructions": textSetting({
    default:
      "Protect the original work with suitable packaging and mark it with the Artwork ID.",
    maxLength: 2000,
  }),
  "artwork.shippingPayer": booleanSetting({ default: false }), // false: sender pays; true: FOA pays
  "org.foaFacilityAddress": textSetting({ default: "", maxLength: 500 }),
  // FOA verification (#92): how long a sent-back entry stays open for its
  // resubmission, counted from the send-back. The owner's default is 7
  // days (2026-11-19); FOA confirms it (HR-37).
  "entries.resubmissionDays": integerSetting({
    default: RESUBMISSION_DAYS.default,
    min: RESUBMISSION_DAYS.min,
    max: RESUBMISSION_DAYS.max,
    unit: "days",
  }),
  // Retention (#114). Off until a super admin turns it on: the daily sweep
  // then deletes and anonymises expired records; while off it only counts
  // them (a dry run, still audited). Every period waits for counsel
  // (HR-31); src/server/modules/privacy/domain/periods.ts holds them.
  "retention.enforce": booleanSetting({ default: false }),
  "retention.expiredVerificationsDays": retentionDays(
    RETENTION_PERIODS.expiredVerifications
  ),
  "retention.expiredSessionsDays": retentionDays(
    RETENTION_PERIODS.expiredSessions
  ),
  "retention.capturedMessagesDays": retentionDays(
    RETENTION_PERIODS.capturedMessages
  ),
  "retention.messageDeliveriesDays": retentionDays(
    RETENTION_PERIODS.messageDeliveries
  ),
  "retention.readInboxItemsDays": retentionDays(
    RETENTION_PERIODS.readInboxItems
  ),
  "retention.quarantinedFilesDays": retentionDays(
    RETENTION_PERIODS.quarantinedFiles
  ),
  "retention.dispatchedOutboxDays": retentionDays(
    RETENTION_PERIODS.dispatchedOutbox
  ),
  "retention.coordinatorInvitationLinksDays": retentionDays(
    RETENTION_PERIODS.coordinatorInvitationLinks
  ),
  "retention.guardianInvitationLinksDays": retentionDays(
    RETENTION_PERIODS.guardianInvitationLinks
  ),
  "retention.coordinatorInvitationsDays": retentionDays(
    RETENTION_PERIODS.coordinatorInvitations
  ),
  "retention.guardianInvitationsDays": retentionDays(
    RETENTION_PERIODS.guardianInvitations
  ),
  [CONTACT_RETENTION.settingKey]: integerSetting({
    default: CONTACT_RETENTION.defaultMonths,
    min: CONTACT_RETENTION.minimumMonths,
    max: CONTACT_RETENTION.maximumMonths,
    unit: "months",
  }),
  "retention.volunteerApplicationsDays": retentionDays(
    RETENTION_PERIODS.volunteerApplications
  ),
  "retention.adoptionApplicationsDays": retentionDays(
    RETENTION_PERIODS.adoptionApplications
  ),
  "retention.releasedLegalHoldsDays": retentionDays(
    RETENTION_PERIODS.releasedLegalHolds
  ),
  "retention.financialRecordsDays": retentionDays(
    RETENTION_PERIODS.financialRecords
  ),
  "retention.privacyRequestsDays": retentionDays(
    RETENTION_PERIODS.privacyRequests
  ),
} satisfies Record<string, SettingDefinition<unknown>>;

export type SettingKey = keyof typeof SETTINGS;

/** The type of a setting's value, from its definition. */
export type SettingValue<K extends SettingKey> =
  (typeof SETTINGS)[K]["default"];

/** Every key, in the order the settings screen lists them. */
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

/** Whether `key` names a setting in the catalogue. */
export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key);
}
