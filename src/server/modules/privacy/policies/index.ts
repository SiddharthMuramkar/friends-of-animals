// The retention policy registry (#114). Every inventory entry names one of
// these keys (./../inventory.ts; the coverage test checks it).
//
// Swept policies are the ones the daily sweep enforces, in the order it
// runs them: timed ones read their period from `retention.<key>Days`, and
// fixed ones leave the date to the module that owns the records. Lifecycle
// policies are what the rest of the data follows instead: it goes with
// the account or record it belongs to, or is kept by design. The privacy
// page explains each (messages/en-IN/adminPrivacy.json).
//
// A ticket that adds personal data names an existing policy, or adds a
// swept policy here (with its period in ../domain/periods.ts and its
// setting in the settings catalogue) or a lifecycle key below.
//
// Loads under plain Node: relative imports only, no "server-only".

import { CONTACT_MESSAGES } from "./contact";
import { FINANCIAL_RECORDS } from "./financial";
import { QUARANTINED_FILES } from "./files";
import {
  COORDINATOR_INVITATION_LINKS,
  COORDINATOR_INVITATIONS,
  GUARDIAN_INVITATION_LINKS,
  GUARDIAN_INVITATIONS,
} from "./invitations";
import { RELEASED_LEGAL_HOLDS } from "./legal-holds";
import {
  CAPTURED_MESSAGES,
  DISPATCHED_OUTBOX,
  MESSAGE_DELIVERIES,
  READ_INBOX_ITEMS,
} from "./messages";
import { BREACH_RECORDS, SAFEGUARDING_REPORTS } from "./module-owned";
import { ORPHANED_PROFILES } from "./profiles";
import { EXPIRED_SESSIONS, EXPIRED_VERIFICATIONS } from "./sign-in";
import type { RetentionPolicy } from "./types";

export type { CandidateQuery, RetentionPolicy } from "./types";

export const SWEPT_POLICIES: readonly RetentionPolicy[] = [
  EXPIRED_VERIFICATIONS,
  EXPIRED_SESSIONS,
  CAPTURED_MESSAGES,
  MESSAGE_DELIVERIES,
  READ_INBOX_ITEMS,
  DISPATCHED_OUTBOX,
  QUARANTINED_FILES,
  // Links first: an invitation past both periods loses its link, then goes.
  COORDINATOR_INVITATION_LINKS,
  GUARDIAN_INVITATION_LINKS,
  COORDINATOR_INVITATIONS,
  GUARDIAN_INVITATIONS,
  ORPHANED_PROFILES,
  CONTACT_MESSAGES,
  SAFEGUARDING_REPORTS,
  BREACH_RECORDS,
  FINANCIAL_RECORDS,
  RELEASED_LEGAL_HOLDS,
];

/** Data the sweep never touches, and what governs it instead. */
export const LIFECYCLE_POLICY_KEYS = [
  /** Deleted with the account (ON DELETE CASCADE); erasure is #115b. */
  "accounts",
  /** Kept while the institution takes part; no job yet (HR-31). */
  "institutions",
  /** Deleted with the post. */
  "posts",
  /** Kept with the revision, including after the staff account goes. */
  "cmsRevisionAuthorship",
  /** Kept with the revision; published revisions are immutable. */
  "cmsRevisionContent",
  /** Kept while the institution's registration is; no job yet (HR-31). */
  "registrations",
  /** Kept while the participant takes part; no job yet (HR-31). */
  "participants",
  /** Kept while a linked child is; deleted with the guardian's account. */
  "guardians",
  /** Who on staff did something: cleared when their account is deleted. */
  "staffRecords",
  /** The append-only audit log, kept by design (HR-30). */
  "auditLog",
  /** Consent given and withdrawn: proof FOA must keep (HR-30, HR-31). */
  "consentRecords",
  /** Kept with the published consent version, which is immutable. */
  "consentDocumentAuthorship",
  "consentDocumentContent",
  /** Signed consent forms (#83): kept with the consent they record. */
  "signedConsentForms",
  /** Consent links (#83): the consent module clears them. */
  "consentLinkContacts",
  "consentLinkSecrets",
  /** Kept while the file is; the Files module deletes files. */
  "files",
  /**
   * Kept with the payment record. offline_payment.proof_file_asset_id is
   * NOT NULL, so a proof (quarantined or not) stays while its payment does.
   */
  "paymentProofs",
  /** Kept with the ledger category, including once it is deactivated. */
  "ledgerCategories",
  /** Removed by the next request once the window ends. */
  "rateLimitWindows",
  /** Competition entries (#85): the entries module's own cleanup. */
  "entries",
  "entryMedia",
  "entryUploadGrants",
  "entryPendingText",
  /** Announcements (#84): kept while the competition's records are. */
  "announcements",
  /** Campaigns (#126): kept with the campaign's record. */
  "campaigns",
] as const;

export type LifecyclePolicyKey = (typeof LIFECYCLE_POLICY_KEYS)[number];

/** Every key an inventory entry may name. */
export const RETENTION_POLICY_KEYS: ReadonlySet<string> = new Set([
  ...SWEPT_POLICIES.map((policy) => policy.key),
  ...LIFECYCLE_POLICY_KEYS,
]);
