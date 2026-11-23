// The data inventory: every database column that holds personal data, what
// FOA keeps it for, whose it is, how long it stays and what happens when
// it expires. Every other column is on the not-personal list
// (./non-personal.ts), and ./inventory.test.ts fails until each column of
// every table is on exactly one of the two, so a ticket that adds a column
// classifies it in the same pull request. docs/privacy/data-inventory.md
// explains the list.
//
// What counts as personal data here: anything that identifies a person or
// says something about one (names, contact details, dates of birth, what
// they wrote, their network address and browser, keyed hashes of any of
// these), and every column that names a person's account, profile or
// guardian record, since that links the row to them. A row's own id,
// timestamps, statuses and organisations' details are not.
//
// Policy keys describe the intended retention of each field. The periods
// are defaults pending counsel confirmation (HR-31).

// Loads under plain Node: relative imports only, no "server-only".

import inventoryMessages from "../../../../messages/en-IN/adminPrivacy.json";

import { CONTACT_INVENTORY } from "../contact/inventory";
import type {
  InventoryEntry,
  OnExpiry,
  PersonalDataCategory,
} from "./domain/coverage";

export type { InventoryEntry };

const PERIODS = inventoryMessages.adminPrivacy.inventory.periods;

/** The policy keys used by the catalogue's retention descriptors. */
export const RETENTION_POLICY_KEYS: ReadonlySet<string> = new Set(
  Object.keys(PERIODS)
);

type Subject = InventoryEntry["subject"];
type Retention = InventoryEntry["retention"];

/**
 * Entries for one table: each shares the table's subject, retention and
 * expiry unless the column says otherwise.
 */
function rowsOf(
  table: string,
  defaults: { subject: Subject; retention: Retention; onExpiry: OnExpiry }
) {
  return (
    column: string,
    category: PersonalDataCategory,
    purpose: string,
    overrides: Partial<Pick<InventoryEntry, "subject" | "onExpiry">> = {}
  ): InventoryEntry => ({
    table,
    column,
    category,
    purpose,
    ...defaults,
    ...overrides,
  });
}

/**
 * A column naming the account of whoever did something to the row (staff
 * who verified, decided or edited it). It goes to null when that account
 * is deleted, unless `onExpiry` says the row can't change.
 */
function actorColumn(
  table: string,
  column: string,
  purpose: string,
  retention: Retention,
  onExpiry: OnExpiry = "set_null"
): InventoryEntry {
  return {
    table,
    column,
    category: "identity",
    purpose,
    subject: { kind: "user", via: column },
    retention,
    onExpiry,
  };
}

const WHILE_ACCOUNT_OPEN = {
  policy: "accounts",
  period: PERIODS.accounts,
  basis: "Needed to sign the person in and reach them about their account",
  toConfirm: true,
} as const;

const WHILE_INSTITUTION_TAKES_PART = {
  policy: "institutions",
  period: PERIODS.institutions,
  basis:
    "FOA reaches the institution about its competitions, and answers queries about past results",
  toConfirm: true,
} as const;

const AFTER_INVITATION_CLOSES = {
  policy: "coordinatorInvitations",
  period: PERIODS.coordinatorInvitations,
  basis:
    "Lets the authorised person and FOA see who was invited, and answer a query about it",
  toConfirm: true,
} as const;

const WHILE_INVITATION_PENDING = {
  policy: "coordinatorInvitationLinks",
  period: PERIODS.coordinatorInvitationLinks,
  basis:
    "Lets the message include the link while the invitation is waiting for an answer",
  toConfirm: true,
} as const;

/** The safeguarding module supplies the retention dates for these reports. */
const SAFEGUARDING_RECORD = {
  policy: "safeguardingReports",
  period: PERIODS.safeguardingReports,
  basis:
    "Child protection: the record of what was reported and done, kept for " +
    "the child, FOA and the authorities (legal basis to confirm)",
  toConfirm: true,
} as const;

const WHILE_POST_EXISTS = {
  policy: "posts",
  period: PERIODS.posts,
  basis:
    "FOA keeps the post's content and byline together and answers for who wrote and changed it",
  toConfirm: true,
} as const;

/** Payment records: an 8-year floor for financial records (HR-31). */
const PAYMENT_RECORD = {
  policy: "financialRecords",
  period: PERIODS.financialRecords,
  basis:
    "Financial records: FOA answers for what was paid, by whom, and what it confirmed, to the payer, its auditors and the tax authorities",
  toConfirm: true,
} as const;

/** The proof stays linked to the payment record. */
const PAYMENT_PROOF = {
  ...PAYMENT_RECORD,
  policy: "paymentProofs",
  period: PERIODS.paymentProofs,
} as const;

const WHILE_REGISTRATION_KEPT = {
  policy: "registrations",
  period: PERIODS.registrations,
  basis:
    "Lets the institution and FOA see who registered it, and answer a query about the registration",
  toConfirm: true,
} as const;

/** A guardian's own record and links: as long as a child of theirs is kept. */
const WHILE_GUARDIAN_LOOKS_AFTER_A_CHILD = {
  policy: "guardians",
  period: PERIODS.guardians,
  basis:
    "Shows who looks after each child and when they confirmed it, the record behind a minor's participation (verifiable parental consent, HR-30)",
  toConfirm: true,
} as const;

/** A teen-login invitation's address and link. */
const AFTER_TEEN_INVITATION_CLOSES = {
  policy: "guardianInvitations",
  period: PERIODS.guardianInvitations.invitation,
  basis:
    "Lets the guardian and FOA see where the invitation went, and answer a query about it",
  toConfirm: true,
} as const;

/** A teen's guardian request (#81): who they named, and its answer. */
const AFTER_GUARDIAN_REQUEST_CLOSES = {
  policy: "guardianInvitations",
  period: PERIODS.guardianInvitations.request,
  basis:
    "Lets FOA ask the person a teen named to confirm them, and answer a query about who was asked and when (HR-30)",
  toConfirm: true,
} as const;

const WHILE_STUDENT_TAKES_PART = {
  policy: "participants",
  period: PERIODS.participants,
  basis:
    "FOA, and the school for its students, run the competition with it, and answer queries about entries, results and certificates",
  toConfirm: true,
} as const;

// Retention added by #114 for the tables the earlier tickets left out.

const WHILE_SESSION_LASTS = {
  policy: "expiredSessions",
  period: PERIODS.expiredSessions,
  basis:
    "Keeps the person signed in, and lets FOA look into a sign-in the person didn't make",
  toConfirm: true,
} as const;

const UNTIL_CODE_EXPIRES = {
  policy: "expiredVerifications",
  period: PERIODS.expiredVerifications,
  basis: "Checks the code or link the person was sent",
  toConfirm: true,
} as const;

const AUDIT_RECORD = {
  policy: "auditLog",
  period: PERIODS.auditLog,
  basis:
    "FOA answers for who did what on the platform, including staff actions on people's data",
  toConfirm: true,
} as const;

const CAPTURED_MESSAGE = {
  policy: "capturedMessages",
  period: PERIODS.capturedMessages,
  basis:
    "Local runs and previews capture messages instead of sending them, so a tester can read them; production captures none",
  toConfirm: true,
} as const;

const DELIVERY_LOG = {
  policy: "messageDeliveries",
  period: PERIODS.messageDeliveries,
  basis:
    "Shows whether a message reached the person, to answer a query or find a fault",
  toConfirm: true,
} as const;

const INBOX_MESSAGE = {
  policy: "readInboxItems",
  period: PERIODS.readInboxItems,
  basis: "The person's own copy of what FOA told them in the app",
  toConfirm: true,
} as const;

const BACKGROUND_JOB = {
  policy: "dispatchedOutbox",
  period: PERIODS.dispatchedOutbox,
  basis:
    "Lets FOA see what ran in the background after a change, to find a fault",
  toConfirm: true,
} as const;

const RATE_LIMIT_WINDOW = {
  policy: "rateLimitWindows",
  period: PERIODS.rateLimitWindows,
  basis: "Stops one network or number from flooding a form or sign-in codes",
  toConfirm: true,
} as const;

const CONSENT_RECORD = {
  policy: "consentRecords",
  period: PERIODS.consentRecords.general,
  basis:
    "FOA must show when a person, or a child's guardian, consented to what (DPDP Act 2023; verifiable parental consent, HR-30)",
  toConfirm: true,
} as const;

/** Who on FOA's staff made or changed a record. */
const STAFF_RECORD = {
  policy: "staffRecords",
  period: PERIODS.staffRecords,
  basis: "FOA answers for who on its staff published, decided or changed what",
  toConfirm: true,
} as const;

/** Authorship stays with immutable CMS revisions after account deletion. */
const CMS_REVISION_AUTHORSHIP = {
  ...STAFF_RECORD,
  policy: "cmsRevisionAuthorship",
  period: PERIODS.cmsRevisionAuthorship,
} as const;

const WHILE_FILE_KEPT = {
  policy: "files",
  period: PERIODS.files,
  basis: "Lets the person who uploaded a file, and staff, find and manage it",
  toConfirm: true,
} as const;

const user = rowsOf("user", {
  subject: { kind: "user", via: "id" },
  retention: WHILE_ACCOUNT_OPEN,
  onExpiry: "delete_row",
});

/** A table whose rows belong to one account and go with it. */
const accountRows = (table: string, via = "user_id") =>
  rowsOf(table, {
    subject: { kind: "user", via },
    retention: WHILE_ACCOUNT_OPEN,
    onExpiry: "delete_row",
  });

const account = accountRows("account");
const secondFactor = accountRows("second_factor");

const session = rowsOf("session", {
  subject: { kind: "user", via: "user_id" },
  retention: WHILE_SESSION_LASTS,
  onExpiry: "delete_row",
});

const verification = rowsOf("verification", {
  subject: { kind: "recipient", via: "identifier" },
  retention: UNTIL_CODE_EXPIRES,
  onExpiry: "delete_row",
});

const institution = rowsOf("institution", {
  subject: { kind: "institution", via: "id" },
  retention: WHILE_INSTITUTION_TAKES_PART,
  onExpiry: "delete_row",
});

const coordinatorInvitation = rowsOf("institution_invitation", {
  subject: { kind: "invitee", via: "identifier_hash" },
  retention: AFTER_INVITATION_CLOSES,
  onExpiry: "delete_row",
});

const safeguardingReport = rowsOf("safeguarding_report", {
  subject: { kind: "safeguarding_report", via: "id" },
  retention: SAFEGUARDING_RECORD,
  onExpiry: "delete_row",
});

const incidentLog = rowsOf("safeguarding_incident_log", {
  subject: { kind: "safeguarding_report", via: "report_id" },
  retention: SAFEGUARDING_RECORD,
  onExpiry: "delete_row",
});

const profile = rowsOf("participant_profile", {
  subject: { kind: "participant_profile", via: "id" },
  retention: WHILE_STUDENT_TAKES_PART,
  onExpiry: "delete_row",
});

const registration = rowsOf("registration", {
  subject: { kind: "participant_profile", via: "participant_profile_id" },
  retention: WHILE_STUDENT_TAKES_PART,
  onExpiry: "delete_row",
});

const guardian = rowsOf("guardian", {
  subject: { kind: "user", via: "user_id" },
  retention: WHILE_GUARDIAN_LOOKS_AFTER_A_CHILD,
  onExpiry: "delete_row",
});

const guardianLink = rowsOf("guardian_link", {
  subject: { kind: "participant_profile", via: "participant_profile_id" },
  retention: WHILE_GUARDIAN_LOOKS_AFTER_A_CHILD,
  onExpiry: "delete_row",
});

const guardianInvitation = rowsOf("guardian_invitation", {
  subject: { kind: "participant_profile", via: "participant_profile_id" },
  retention: AFTER_TEEN_INVITATION_CLOSES,
  onExpiry: "delete_row",
});

// The kind distinguishes an invited teen from a requested guardian.
const GUARDIAN_INVITATION_RECIPIENT = {
  kind: "invitee",
  via: "kind + contact_hash",
} as const;

/** A payment record: anonymised once the financial floor has passed. */
const payment = (table: string, via: string) =>
  rowsOf(table, {
    subject: { kind: "payer", via },
    retention: PAYMENT_RECORD,
    onExpiry: "set_null",
  });

const auditLog = rowsOf("audit_log", {
  subject: { kind: "user", via: "actor_user_id" },
  retention: AUDIT_RECORD,
  onExpiry: "retain",
});

// The entity type selects what the entity id refers to.
const AUDIT_TARGET = { kind: "audit_target", via: "entity_type + entity_id" };

const capturedMessage = rowsOf("captured_message", {
  subject: { kind: "recipient", via: "to_address" },
  retention: CAPTURED_MESSAGE,
  onExpiry: "delete_row",
});

export const DATA_INVENTORY: readonly InventoryEntry[] = [
  // Accounts (#57, #58)
  user("name", "identity", "Greets the person and names them to staff"),
  user(
    "email",
    "contact",
    "Signs the person in by email code and sends their messages"
  ),
  user(
    "phone_ciphertext",
    "contact",
    "Signs the person in by SMS code (encrypted)"
  ),
  user(
    "phone_hash",
    "technical",
    "A keyed hash of the person's phone, to find their account by it without reading it"
  ),
  user(
    "image",
    "identity",
    "A profile picture's address, when the sign-in provider gives one"
  ),
  account(
    "user_id",
    "identity",
    "Links a sign-in method to the person's account"
  ),
  account(
    "account_id",
    "identity",
    "The person's id at the sign-in provider (their own account id for email codes)"
  ),
  account(
    "access_token",
    "technical",
    "A sign-in provider's access token for the person, when one is used"
  ),
  account(
    "refresh_token",
    "technical",
    "A sign-in provider's refresh token for the person, when one is used"
  ),
  account(
    "id_token",
    "technical",
    "A sign-in provider's identity token, which carries the person's name and email"
  ),
  account(
    "password",
    "technical",
    "A password hash, if a password sign-in is ever turned on (none today)"
  ),
  session("user_id", "identity", "Links the session to the signed-in account"),
  session(
    "token",
    "technical",
    "The session's secret, which the browser's cookie carries"
  ),
  session(
    "ip_address",
    "technical",
    "The network address the person signed in from, to spot a sign-in they didn't make"
  ),
  session(
    "user_agent",
    "technical",
    "The browser and device the person signed in with, shown so they recognise their sessions"
  ),
  verification(
    "identifier",
    "contact",
    "A hash of the email sign-in identifier, or a namespaced keyed hash of the phone number, to find the recipient's verification even before they have an account"
  ),
  verification(
    "value",
    "technical",
    "The hashed email code or keyed SMS code digest, stored with the count of failed attempts"
  ),
  rowsOf("otp_rate_limit", {
    subject: { kind: "visitor", via: "key_hash" },
    retention: RATE_LIMIT_WINDOW,
    onExpiry: "delete_row",
  })(
    "key_hash",
    "technical",
    "A keyed hash of the email, phone or network asking for sign-in codes, never the value"
  ),
  rowsOf("form_rate_limit", {
    subject: { kind: "visitor", via: "key_hash" },
    retention: RATE_LIMIT_WINDOW,
    onExpiry: "delete_row",
  })(
    "key_hash",
    "technical",
    "A keyed hash of the network or address sending a public form, never the value"
  ),
  // Roles and the audit log (#59)
  accountRows("user_role")(
    "user_id",
    "identity",
    "Says which account holds the role"
  ),
  actorColumn(
    "user_role",
    "granted_by_user_id",
    "Records which super admin granted the role",
    STAFF_RECORD
  ),
  auditLog(
    "actor_user_id",
    "identity",
    "Records which account took the action"
  ),
  auditLog(
    "entity_id",
    "identity",
    "Names the record acted on, which is a person's account or profile for some actions",
    { subject: AUDIT_TARGET }
  ),
  auditLog(
    "before",
    "content",
    "The changed fields before the action: ids and values, never a whole row",
    { subject: AUDIT_TARGET }
  ),
  auditLog(
    "after",
    "content",
    "The changed fields after the action: ids and values, never a whole row",
    { subject: AUDIT_TARGET }
  ),
  auditLog(
    "ip",
    "technical",
    "The network address the action came from, to look into misuse"
  ),
  auditLog(
    "user_agent",
    "technical",
    "The browser the action came from, to look into misuse"
  ),
  // Second factor (#60)
  secondFactor(
    "user_id",
    "identity",
    "Links an authenticator app or passkey to its account"
  ),
  secondFactor(
    "label",
    "identity",
    "The name the person gave their authenticator or passkey, which may name them or their device"
  ),
  secondFactor(
    "credential_id",
    "technical",
    "The passkey's id, to find it when the person signs in with it"
  ),
  secondFactor(
    "public_key",
    "technical",
    "The passkey's public key, to check the person's signature"
  ),
  secondFactor(
    "totp_secret_sealed",
    "technical",
    "The authenticator app's shared secret, sealed, to check its codes"
  ),
  accountRows("second_factor_lockout")(
    "user_id",
    "identity",
    "Links a run of wrong second-factor codes to the account it locks"
  ),
  // Messages (#69)
  accountRows("notification_preference")(
    "user_id",
    "identity",
    "Links message choices to the person's account"
  ),
  accountRows("notification_preference")(
    "email",
    "preference",
    "Whether the person wants optional messages by email"
  ),
  accountRows("notification_preference")(
    "sms",
    "preference",
    "Whether the person wants optional messages by text"
  ),
  rowsOf("message_delivery", {
    subject: { kind: "user", via: "user_id" },
    retention: DELIVERY_LOG,
    onExpiry: "delete_row",
  })("user_id", "identity", "Says who a message was sent to"),
  ...(["user_id", "title", "body"] as const).map((column) =>
    rowsOf("inbox_item", {
      subject: { kind: "user", via: "user_id" },
      retention: INBOX_MESSAGE,
      onExpiry: "delete_row",
    })(
      column,
      column === "user_id" ? "identity" : "content",
      column === "user_id"
        ? "Says whose in-app message it is"
        : "What FOA told the person in the app, which may name them or their child"
    )
  ),
  capturedMessage(
    "to_address",
    "contact",
    "Where a captured message would have gone (local runs and previews only)"
  ),
  capturedMessage(
    "subject",
    "content",
    "A captured message's subject, which may name the person"
  ),
  capturedMessage(
    "body_text",
    "content",
    "A captured message's words, which may hold the person's name or code"
  ),
  capturedMessage(
    "body_html",
    "content",
    "A captured message's words as sent, which may hold the person's name or code"
  ),
  ...(["aggregate_id", "payload", "last_error"] as const).map((column) =>
    rowsOf("outbox", {
      subject: { kind: "user", via: "payload" },
      retention: BACKGROUND_JOB,
      onExpiry: "delete_row",
    })(
      column,
      "technical",
      column === "last_error"
        ? "Why a background job failed, which may quote a record it read"
        : "The ids a background job works on, which can be a person's account or profile"
    )
  ),
  // Consent (#64)
  rowsOf("consent_event", {
    subject: { kind: "consent_subject", via: "subject_id" },
    retention: CONSENT_RECORD,
    onExpiry: "retain",
  })(
    "subject_id",
    "identity",
    "Says whose consent it is: an account or a child's profile"
  ),
  rowsOf("consent_event", {
    subject: { kind: "user", via: "giver_user_id" },
    retention: CONSENT_RECORD,
    onExpiry: "set_null",
  })(
    "giver_user_id",
    "identity",
    "Says who gave or withdrew the consent: the person, or a child's guardian"
  ),
  rowsOf("consent_event", {
    subject: { kind: "consent_subject", via: "subject_id" },
    retention: {
      ...CONSENT_RECORD,
      period: PERIODS.consentRecords.competition,
    },
    onExpiry: "retain",
  })(
    "competition_id",
    "technical",
    "Identifies the competition to which the consent applies"
  ),
  // Files (#63)
  rowsOf("file_asset", {
    subject: { kind: "user", via: "owner_user_id" },
    retention: WHILE_FILE_KEPT,
    onExpiry: "delete_row",
  })(
    "owner_user_id",
    "identity",
    "Says who uploaded the file, so only they and staff reach it"
  ),
  // Staff who made or changed a record
  ...(
    [
      [
        "competition",
        "created_by_user_id",
        "Records which competition manager created the competition",
      ],
      [
        "competition_award_scheme",
        "updated_by_user_id",
        "Records who last changed a competition's prizes",
      ],
      [
        "competition_consent_document",
        "attached_by_user_id",
        "Records who attached a consent document to a competition",
      ],
      [
        "competition_fee",
        "updated_by_user_id",
        "Records who last changed a competition's fee",
      ],
      [
        "consent_document",
        "published_by_user_id",
        "Records who published a consent document",
      ],
      [
        "message_template",
        "updated_by_user_id",
        "Records who last changed a message template",
      ],
      [
        "setting",
        "updated_by_user_id",
        "Records which super admin last changed a setting",
      ],
    ] as const
  ).map(([table, column, purpose]) =>
    actorColumn(table, column, purpose, STAFF_RECORD)
  ),
  // Frozen once published (#88, #111): the row can't change, so the id stays.
  actorColumn(
    "cms_revision",
    "created_by_user_id",
    "Records who wrote a page revision",
    CMS_REVISION_AUTHORSHIP,
    "retain"
  ),
  actorColumn(
    "cms_revision",
    "published_by_user_id",
    "Records who published a page revision",
    CMS_REVISION_AUTHORSHIP,
    "retain"
  ),
  ...(
    [
      ["rubric", "created_by_user_id", "Records who wrote a judging rubric"],
      [
        "rubric",
        "published_by_user_id",
        "Records who published a judging rubric",
      ],
    ] as const
  ).map(([table, column, purpose]) =>
    actorColumn(table, column, purpose, STAFF_RECORD, "retain")
  ),
  // Institutions (#73)
  institution(
    "contact_email",
    "contact",
    "Reaches the institution's office about its registration"
  ),
  institution(
    "contact_phone",
    "contact",
    "Reaches the institution's office about its registration"
  ),
  institution(
    "principal_name",
    "identity",
    "Names the head of the institution FOA verifies it with"
  ),
  institution(
    "principal_email_ciphertext",
    "contact",
    "Lets FOA staff confirm the registration with the principal (encrypted)"
  ),
  institution(
    "principal_phone_ciphertext",
    "contact",
    "Lets FOA staff confirm the registration with the principal (encrypted)"
  ),
  institution(
    "status_reason",
    "content",
    "Records the reason staff gave for the institution decision"
  ),
  institution(
    "created_by",
    "identity",
    "Links the institution to its authorised person, who becomes its admin",
    { subject: { kind: "user", via: "created_by" }, onExpiry: "retain" }
  ),
  institution(
    "verified_by",
    "identity",
    "Records which FOA staff member verified the institution",
    { subject: { kind: "user", via: "verified_by" }, onExpiry: "set_null" }
  ),
  // Coordinator invitations (#74)
  coordinatorInvitation(
    "identifier_ciphertext",
    "contact",
    "The email or mobile number a coordinator invitation goes to (encrypted)"
  ),
  coordinatorInvitation(
    "identifier_hash",
    "technical",
    "Matches the invitee's account, and a second invitation to the same person, without storing the address readably"
  ),
  {
    table: "institution_invitation",
    column: "token_ciphertext",
    category: "technical",
    purpose:
      "The invitation link's secret, so the message can carry it (encrypted)",
    subject: { kind: "invitee", via: "identifier_hash" },
    retention: WHILE_INVITATION_PENDING,
    onExpiry: "set_null",
  },
  coordinatorInvitation(
    "invited_by_user_id",
    "identity",
    "Records which authorised person sent the invitation"
  ),
  coordinatorInvitation(
    "accepted_by_user_id",
    "identity",
    "Records which account accepted the invitation"
  ),
  coordinatorInvitation(
    "revoked_by_user_id",
    "identity",
    "Records which authorised person withdrew the invitation"
  ),
  // Safeguarding reports (#116): only a safeguarding lead reads them
  safeguardingReport(
    "description_ciphertext",
    "content",
    "What the reporter saw or was told, so the safeguarding lead can act (encrypted)"
  ),
  safeguardingReport(
    "subject_details_ciphertext",
    "identity",
    "Who the concern is about (a name, a school, a username), to find the child (encrypted)"
  ),
  safeguardingReport(
    "subject_age",
    "demographic",
    "The child's rough age, to judge urgency and how long to keep the report"
  ),
  safeguardingReport(
    "reporter_name_ciphertext",
    "identity",
    "Who reported, when they chose not to stay anonymous, to follow up (encrypted)"
  ),
  safeguardingReport(
    "reporter_is_child",
    "demographic",
    "Whether the reporter is a child, so the safeguarding lead can respond appropriately"
  ),
  safeguardingReport(
    "reporter_contact_ciphertext",
    "contact",
    "How to reach the reporter (email or phone), when they chose to be reached (encrypted)"
  ),
  safeguardingReport(
    "escalation_reference_ciphertext",
    "content",
    "The outside authority's reference, to follow the case with them (encrypted)"
  ),
  safeguardingReport(
    "outcome_ciphertext",
    "content",
    "What the safeguarding lead decided and did, as the record of the case (encrypted)"
  ),
  safeguardingReport(
    "assigned_to_user_id",
    "identity",
    "Records which safeguarding lead is handling the report"
  ),
  incidentLog(
    "body_ciphertext",
    "content",
    "The lead's notes and decisions over the case's life, as its record (encrypted)"
  ),
  incidentLog(
    "author_user_id",
    "identity",
    "Records which safeguarding lead wrote each log entry"
  ),
  // Blog posts and stories (#112)
  ...Object.entries({
    body: "The text of the post, which may name or describe a person",
    excerpt: "The summary of the post, which may name or describe a person",
  }).map(([column, purpose]): InventoryEntry => ({
    table: "cms_post",
    column,
    category: "content",
    purpose,
    subject: { kind: "content_subject", via: column },
    retention: WHILE_POST_EXISTS,
    onExpiry: "delete_row",
  })),
  {
    table: "cms_post",
    column: "author_name",
    category: "identity",
    purpose: "The byline a post shows, as its editor typed it (optional)",
    subject: { kind: "author", via: "author_name" },
    retention: WHILE_POST_EXISTS,
    onExpiry: "delete_row",
  },
  actorColumn(
    "cms_post",
    "created_by",
    "Records which content manager started the post",
    WHILE_POST_EXISTS
  ),
  actorColumn(
    "cms_post",
    "updated_by",
    "Records which content manager last changed the post",
    WHILE_POST_EXISTS
  ),
  // Institution registrations for a competition (#75)
  actorColumn(
    "institution_registration",
    "registered_by",
    "Records which coordinator or authorised person registered the institution for the competition",
    WHILE_REGISTRATION_KEPT
  ),
  // Students an institution enrols (#75)
  profile(
    "full_name",
    "identity",
    "Names the participant (a school's student, an adult on their own, or a guardian's child) on lists, entries and certificates"
  ),
  profile(
    "dob_ciphertext",
    "demographic",
    "Places the participant in an age group on the competition's cut-off date, keeps an adult registering on their own from being a minor, and tells a guardian's child under 13 (no login) from a teen (own login) (encrypted)"
  ),
  profile(
    "grade",
    "demographic",
    "Shows the student's class or year on the school's list"
  ),
  profile(
    "student_ref",
    "identity",
    "The school's own roll number, so the school recognises the student and FOA spots the same student entered twice"
  ),
  profile(
    "phone_ciphertext",
    "contact",
    "Reaches an adult student, or an adult registered on their own, about their entry (encrypted)"
  ),
  profile(
    "email_ciphertext",
    "contact",
    "Reaches an adult student about their entry (encrypted)"
  ),
  profile(
    "guardian_name_ciphertext",
    "identity",
    "Names a minor's parent or guardian to contact (encrypted)"
  ),
  profile(
    "guardian_relationship",
    "demographic",
    "Says whether the contact is the minor's parent or legal guardian"
  ),
  profile(
    "guardian_phone_ciphertext",
    "contact",
    "Reaches a minor's parent or guardian about the entry (encrypted)"
  ),
  profile(
    "guardian_email_ciphertext",
    "contact",
    "Reaches a minor's parent or guardian about the entry (encrypted)"
  ),
  profile(
    "address_ciphertext",
    "contact",
    "Where certificates or artwork go back to, when it differs from the school (encrypted)"
  ),
  profile(
    "pin_code",
    "demographic",
    "Locates the participant for regional rounds and reports (an adult abroad gives their postal code)"
  ),
  profile(
    "city",
    "demographic",
    "Locates the participant for regional rounds and reports"
  ),
  profile(
    "state",
    "demographic",
    "Locates the participant for regional rounds and reports"
  ),
  profile(
    "identity_hash",
    "technical",
    "A keyed hash of the name and date of birth that spots the same student entered twice, without reading either"
  ),
  profile(
    "created_by",
    "identity",
    "Records which coordinator or authorised person first entered the student",
    { subject: { kind: "user", via: "created_by" }, onExpiry: "set_null" }
  ),
  // Adults who register themselves (#78): their own profile
  profile(
    "owner_user_id",
    "identity",
    "Links an adult's own profile to their account, or a child's profile to the guardian who keeps it (#81), so only they see and act on it",
    { onExpiry: "set_null" }
  ),
  profile(
    "participant_code",
    "identity",
    "The FOA Participant ID that names an adult to FOA across competitions; never a way to sign in"
  ),
  profile(
    "country",
    "demographic",
    "Where an adult on their own lives, so their postal code reads right and FOA reports by country"
  ),
  profile(
    "school_name",
    "demographic",
    "The school or college an adult on their own names, if any, so FOA can invite it to take part"
  ),
  // Registrations (#75, #78): an entry names the participant and age group.
  registration("participant_profile_id", "identity", "Says whose entry it is"),
  registration(
    "age_group_id",
    "demographic",
    "Records the age group assigned from the participant's date of birth and the competition's cut-off date"
  ),
  // Fee payments (#77). Webhook events keep no body: it carries the payer's
  // email and phone.
  payment("payment_batch", "payer_user_id")(
    "payer_user_id",
    "identity",
    "Records who paid an institution's fees, or an adult their own (#78), so the receipt reaches them and FOA can answer a query about the payment"
  ),
  // Offline payments and payments needing review (#79).
  payment("offline_payment", "batch_id")(
    "reference",
    "financial",
    "The cheque number, bank transfer reference or FOA cash receipt finance recorded a payment with, so the money can be traced to the payer's bank",
    { onExpiry: "tombstone" }
  ),
  {
    table: "offline_payment",
    column: "proof_file_asset_id",
    category: "financial",
    purpose:
      "The scan or photo of the cheque, transfer advice or cash receipt; a cheque shows the payer's account number and signature. Only finance and staff admins open it",
    subject: { kind: "payer", via: "batch_id" },
    retention: PAYMENT_PROOF,
    onExpiry: "retain",
  },
  actorColumn(
    "offline_payment",
    "recorded_by_user_id",
    "Who in finance recorded the offline payment, so FOA can answer for it",
    PAYMENT_RECORD
  ),
  payment("payment_review_case", "batch_id")(
    "resolution_reason",
    "content",
    "Why staff accepted, refunded or kept a payment in review: free text that may name the payer or what they said",
    { onExpiry: "tombstone" }
  ),
  actorColumn(
    "payment_review_case",
    "resolved_by_user_id",
    "Who resolved a payment in review, so FOA can answer for it",
    PAYMENT_RECORD
  ),
  // Refunds (#80): money records, kept as long as the payment they return.
  payment("refund", "batch_id")(
    "reason",
    "content",
    "Why a refund was asked for, or why the system made it: free text that may name the payer or what they said",
    { onExpiry: "tombstone" }
  ),
  actorColumn(
    "refund",
    "requested_by",
    "Who asked for a refund, so nobody decides their own request",
    PAYMENT_RECORD
  ),
  actorColumn(
    "refund",
    "decided_by",
    "Who in finance approved or rejected a refund, so FOA can answer for it",
    PAYMENT_RECORD
  ),
  payment("refund", "batch_id")(
    "decision_note",
    "content",
    "Finance's note on approving or rejecting a refund: free text the requester reads"
  ),
  payment("refund", "batch_id")(
    "manual_reference",
    "financial",
    "The transfer reference (UTR), cheque number or cash receipt of a refund paid back by hand",
    { onExpiry: "tombstone" }
  ),
  actorColumn(
    "refund",
    "manual_recorded_by",
    "Who in finance recorded paying a refund back by hand",
    PAYMENT_RECORD
  ),
  // Guardians and their children (#81). A child's profile is a
  // participant_profile row (owner_kind guardian), listed above.
  guardian(
    "user_id",
    "identity",
    "Links the guardian's declaration to their account, so only they manage their children"
  ),
  guardian(
    "full_name_ciphertext",
    "identity",
    "Names the parent or guardian who looks after a child, to the child and to FOA (encrypted)"
  ),
  guardian(
    "phone_ciphertext",
    "contact",
    "Reaches a child's parent or guardian about the child, if they gave a phone (encrypted)"
  ),
  guardian(
    "phone_hash",
    "technical",
    "A keyed hash of the guardian's phone, to find it without reading it"
  ),
  guardian(
    "adult_declared_at",
    "demographic",
    "When the guardian declared they are 18 or older and the child's parent or lawful guardian"
  ),
  guardian(
    "verified_at",
    "technical",
    "When the guardian confirmed the declaration with a one-time code sent to them"
  ),
  guardianLink(
    "relationship",
    "demographic",
    "Says whether the guardian is the child's parent or legal guardian"
  ),
  guardianLink(
    "guardian_id",
    "identity",
    "Says which guardian looks after the child"
  ),
  guardianLink(
    "participant_profile_id",
    "identity",
    "Says which child the guardian looks after"
  ),
  guardianInvitation(
    "contact_ciphertext",
    "contact",
    "The email a guardian invited their teen to an own login at, or a teen gave for the guardian they asked (#81), to send the link (encrypted)",
    { subject: GUARDIAN_INVITATION_RECIPIENT }
  ),
  guardianInvitation(
    "contact_hash",
    "technical",
    "A keyed hash of the invited email, to check that the teen or guardian accepting signed in with it",
    { subject: GUARDIAN_INVITATION_RECIPIENT }
  ),
  {
    table: "guardian_invitation",
    column: "token_ciphertext",
    category: "technical",
    purpose:
      "The invitation link's token, to build the link when the message is sent (encrypted)",
    subject: { kind: "participant_profile", via: "participant_profile_id" },
    retention: {
      ...WHILE_INVITATION_PENDING,
      policy: "guardianInvitationLinks",
      period: PERIODS.guardianInvitationLinks,
    },
    onExpiry: "set_null",
  },
  guardianInvitation(
    "accepted_by_user_id",
    "identity",
    "Records which account accepted the invitation as the teen's own, or a teen's guardian request as their guardian (#81)"
  ),
  guardianInvitation(
    "guardian_id",
    "identity",
    "Says which guardian sent the invitation, or accepted a teen's request"
  ),
  guardianInvitation(
    "participant_profile_id",
    "identity",
    "Says which child the invitation or request is about"
  ),
  rowsOf("guardian_invitation", {
    subject: GUARDIAN_INVITATION_RECIPIENT,
    retention: AFTER_GUARDIAN_REQUEST_CLOSES,
    onExpiry: "delete_row",
  })(
    "invitee_name_ciphertext",
    "identity",
    "The name a teen gave for the parent or guardian they asked FOA to contact, to greet them in the request (encrypted)"
  ),
  rowsOf("guardian_invitation", {
    subject: { kind: "user", via: "requested_by_user_id" },
    retention: AFTER_GUARDIAN_REQUEST_CLOSES,
    onExpiry: "delete_row",
  })(
    "relationship",
    "demographic",
    "How a teen says the person they named is related to them, shown to that person to confirm"
  ),
  rowsOf("guardian_invitation", {
    subject: { kind: "user", via: "requested_by_user_id" },
    retention: AFTER_GUARDIAN_REQUEST_CLOSES,
    onExpiry: "delete_row",
  })(
    "requested_by_user_id",
    "identity",
    "Links a guardian request to the teen who asked, so their held registrations are released to the guardian who accepts"
  ),
  profile(
    "login_user_id",
    "identity",
    "Links a guardian's 13- to 17-year-old child to their own login, so they take part themselves",
    { subject: { kind: "user", via: "login_user_id" }, onExpiry: "set_null" }
  ),
  // The contact inbox (#113): its own module lists what a sender wrote.
  ...CONTACT_INVENTORY,
];
