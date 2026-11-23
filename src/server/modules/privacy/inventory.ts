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

import { CONTACT_INVENTORY, MONTHS_AFTER_CLOSE } from "../contact/inventory";
import type {
  InventoryEntry,
  OnExpiry,
  PersonalDataCategory,
} from "./domain/coverage";

export type { InventoryEntry };

const policyPeriods = inventoryMessages.adminPrivacy.inventory.periods;
const {
  consentRecords,
  financialRecords,
  guardianInvitations,
  ...simplePeriods
} = policyPeriods;
const PERIOD_TEXT = {
  ...simplePeriods,
  "consentRecords.general": consentRecords.general,
  "consentRecords.competition": consentRecords.competition,
  "financialRecords.payments": financialRecords.payments,
  "financialRecords.ledger": financialRecords.ledger,
  "guardianInvitations.invitation": guardianInvitations.invitation,
  "guardianInvitations.request": guardianInvitations.request,
};
const PURPOSES: Partial<Record<string, Partial<Record<string, string>>>> =
  inventoryMessages.adminPrivacy.inventory.purposes;

/** The policy keys used by the catalogue's retention descriptors. */
export const RETENTION_POLICY_KEYS: ReadonlySet<string> = new Set(
  Object.keys(policyPeriods)
);

type Subject = InventoryEntry["subject"];
type StaticPeriodKey = Exclude<keyof typeof PERIOD_TEXT, "contactMessages">;
type Retention = Omit<InventoryEntry["retention"], "period"> & {
  periodKey: StaticPeriodKey;
};
type InventoryField = Omit<InventoryEntry, "purpose" | "retention"> & {
  retention: Retention;
};

export type InventoryViewEntry = InventoryEntry & {
  retentionMessage:
    | { key: StaticPeriodKey; values?: never }
    | { key: "contactMessages"; values: { months: number } };
};

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
    overrides: Partial<Pick<InventoryEntry, "subject" | "onExpiry">> = {}
  ): InventoryField => ({
    table,
    column,
    category,
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
  retention: Retention,
  onExpiry: OnExpiry = "set_null"
): InventoryField {
  return {
    table,
    column,
    category: "identity",
    subject: { kind: "user", via: column },
    retention,
    onExpiry,
  };
}

const WHILE_ACCOUNT_OPEN = {
  policy: "accounts",
  periodKey: "accounts",
  basis: "Needed to sign the person in and reach them about their account",
  toConfirm: true,
} as const;

const WHILE_INSTITUTION_TAKES_PART = {
  policy: "institutions",
  periodKey: "institutions",
  basis:
    "FOA reaches the institution about its competitions, and answers queries about past results",
  toConfirm: true,
} as const;

const AFTER_INVITATION_CLOSES = {
  policy: "coordinatorInvitations",
  periodKey: "coordinatorInvitations",
  basis:
    "Lets the authorised person and FOA see who was invited, and answer a query about it",
  toConfirm: true,
} as const;

const WHILE_INVITATION_PENDING = {
  policy: "coordinatorInvitationLinks",
  periodKey: "coordinatorInvitationLinks",
  basis:
    "Lets the message include the link while the invitation is waiting for an answer",
  toConfirm: true,
} as const;

/** The safeguarding module supplies the retention dates for these reports. */
const SAFEGUARDING_RECORD = {
  policy: "safeguardingReports",
  periodKey: "safeguardingReports",
  basis:
    "Child protection: the record of what was reported and done, kept for " +
    "the child, FOA and the authorities (legal basis to confirm)",
  toConfirm: true,
} as const;

const WHILE_POST_EXISTS = {
  policy: "posts",
  periodKey: "posts",
  basis:
    "FOA keeps the post's content and byline together and answers for who wrote and changed it",
  toConfirm: true,
} as const;

/** Payment records: an 8-year floor for financial records (HR-31). */
const PAYMENT_RECORD = {
  policy: "financialRecords",
  periodKey: "financialRecords.payments",
  basis:
    "Financial records: FOA answers for what was paid, by whom, and what it confirmed, to the payer, its auditors and the tax authorities",
  toConfirm: true,
} as const;

const LEDGER_RECORD = {
  policy: "financialRecords",
  periodKey: "financialRecords.ledger",
  basis:
    "FOA keeps the journal and its attribution for accounting and tax records",
  toConfirm: true,
} as const;

const LEDGER_CATEGORY = {
  policy: "ledgerCategories",
  periodKey: "ledgerCategories",
  basis: "FOA can identify the categories used in its financial records",
  toConfirm: true,
} as const;

/** The proof stays linked to the payment record. */
const PAYMENT_PROOF = {
  ...PAYMENT_RECORD,
  policy: "paymentProofs",
  periodKey: "paymentProofs",
} as const;

const WHILE_REGISTRATION_KEPT = {
  policy: "registrations",
  periodKey: "registrations",
  basis:
    "Lets the institution and FOA see who registered it, and answer a query about the registration",
  toConfirm: true,
} as const;

/** A guardian's own record and links: as long as a child of theirs is kept. */
const WHILE_GUARDIAN_LOOKS_AFTER_A_CHILD = {
  policy: "guardians",
  periodKey: "guardians",
  basis:
    "Shows who looks after each child and when they confirmed it, the record behind a minor's participation (verifiable parental consent, HR-30)",
  toConfirm: true,
} as const;

/** A teen-login invitation's address and link. */
const AFTER_TEEN_INVITATION_CLOSES = {
  policy: "guardianInvitations",
  periodKey: "guardianInvitations.invitation",
  basis:
    "Lets the guardian and FOA see where the invitation went, and answer a query about it",
  toConfirm: true,
} as const;

/** A teen's guardian request (#81): who they named, and its answer. */
const AFTER_GUARDIAN_REQUEST_CLOSES = {
  policy: "guardianInvitations",
  periodKey: "guardianInvitations.request",
  basis:
    "Lets FOA ask the person a teen named to confirm them, and answer a query about who was asked and when (HR-30)",
  toConfirm: true,
} as const;

const WHILE_STUDENT_TAKES_PART = {
  policy: "participants",
  periodKey: "participants",
  basis:
    "FOA, and the school for its students, run the competition with it, and answer queries about entries, results and certificates",
  toConfirm: true,
} as const;

// Retention added by #114 for the tables the earlier tickets left out.

const WHILE_SESSION_LASTS = {
  policy: "expiredSessions",
  periodKey: "expiredSessions",
  basis:
    "Keeps the person signed in, and lets FOA look into a sign-in the person didn't make",
  toConfirm: true,
} as const;

const UNTIL_CODE_EXPIRES = {
  policy: "expiredVerifications",
  periodKey: "expiredVerifications",
  basis: "Checks the code or link the person was sent",
  toConfirm: true,
} as const;

const AUDIT_RECORD = {
  policy: "auditLog",
  periodKey: "auditLog",
  basis:
    "FOA answers for who did what on the platform, including staff actions on people's data",
  toConfirm: true,
} as const;

const CAPTURED_MESSAGE = {
  policy: "capturedMessages",
  periodKey: "capturedMessages",
  basis:
    "Local runs and previews capture messages instead of sending them, so a tester can read them; production captures none",
  toConfirm: true,
} as const;

const DELIVERY_LOG = {
  policy: "messageDeliveries",
  periodKey: "messageDeliveries",
  basis:
    "Shows whether a message reached the person, to answer a query or find a fault",
  toConfirm: true,
} as const;

const INBOX_MESSAGE = {
  policy: "readInboxItems",
  periodKey: "readInboxItems",
  basis: "The person's own copy of what FOA told them in the app",
  toConfirm: true,
} as const;

const BACKGROUND_JOB = {
  policy: "dispatchedOutbox",
  periodKey: "dispatchedOutbox",
  basis:
    "Lets FOA see what ran in the background after a change, to find a fault",
  toConfirm: true,
} as const;

const RATE_LIMIT_WINDOW = {
  policy: "rateLimitWindows",
  periodKey: "rateLimitWindows",
  basis: "Stops one network or number from flooding a form or sign-in codes",
  toConfirm: true,
} as const;

const CONSENT_RECORD = {
  policy: "consentRecords",
  periodKey: "consentRecords.general",
  basis:
    "FOA must show when a person, or a child's guardian, consented to what (DPDP Act 2023; verifiable parental consent, HR-30)",
  toConfirm: true,
} as const;

/** Who on FOA's staff made or changed a record. */
const STAFF_RECORD = {
  policy: "staffRecords",
  periodKey: "staffRecords",
  basis: "FOA answers for who on its staff published, decided or changed what",
  toConfirm: true,
} as const;

/** Authorship stays with immutable CMS revisions after account deletion. */
const CMS_REVISION_AUTHORSHIP = {
  ...STAFF_RECORD,
  policy: "cmsRevisionAuthorship",
  periodKey: "cmsRevisionAuthorship",
} as const;

const CMS_REVISION_CONTENT = {
  policy: "cmsRevisionContent",
  periodKey: "cmsRevisionContent",
  basis: "FOA can show the content of each published version of a page",
  toConfirm: true,
} as const;

const CONSENT_DOCUMENT_AUTHORSHIP = {
  ...STAFF_RECORD,
  policy: "consentDocumentAuthorship",
  periodKey: "consentDocumentAuthorship",
} as const;

const CONSENT_DOCUMENT_CONTENT = {
  policy: "consentDocumentContent",
  periodKey: "consentDocumentContent",
  basis: "FOA can show the exact terms and notices people consented to",
  toConfirm: true,
} as const;

const WHILE_FILE_KEPT = {
  policy: "files",
  periodKey: "files",
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
  subject: {
    kind: "recipient",
    via: "identifier (email sign-in hash, sms-sign-in:<phone hash>, or guardian-verification:<guardian id> → guardian.user_id)",
  },
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

// School enrolment can record a guardian contact without a guardian account.
const PROFILE_GUARDIAN_CONTACT = {
  kind: "guardian_contact",
  via: "participant_profile.guardian_phone_ciphertext or participant_profile.guardian_email_ciphertext",
};

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

const GUARDIAN_ACCOUNT = {
  kind: "user",
  via: "guardian_id → guardian.user_id",
};

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

const INVENTORY_FIELDS: readonly InventoryField[] = [
  // Accounts (#57, #58)
  user("name", "identity"),
  user("email", "contact"),
  user("phone_ciphertext", "contact"),
  user("phone_hash", "technical"),
  user("image", "identity"),
  account("user_id", "identity"),
  account("account_id", "identity"),
  account("access_token", "technical"),
  account("refresh_token", "technical"),
  account("id_token", "technical"),
  account("password", "technical"),
  session("user_id", "identity"),
  session("token", "technical"),
  session("ip_address", "technical"),
  session("user_agent", "technical"),
  verification("identifier", "contact"),
  verification("value", "technical"),
  rowsOf("otp_rate_limit", {
    subject: { kind: "visitor", via: "key_hash" },
    retention: RATE_LIMIT_WINDOW,
    onExpiry: "delete_row",
  })("key_hash", "technical"),
  rowsOf("form_rate_limit", {
    subject: { kind: "visitor", via: "key_hash" },
    retention: RATE_LIMIT_WINDOW,
    onExpiry: "delete_row",
  })("key_hash", "technical"),
  // Roles and the audit log (#59)
  accountRows("user_role")("user_id", "identity"),
  actorColumn("user_role", "granted_by_user_id", STAFF_RECORD),
  auditLog("actor_user_id", "identity"),
  auditLog("entity_id", "identity", { subject: AUDIT_TARGET }),
  auditLog("before", "content", { subject: AUDIT_TARGET }),
  auditLog("after", "content", { subject: AUDIT_TARGET }),
  auditLog("ip", "technical"),
  auditLog("user_agent", "technical"),
  // Second factor (#60)
  secondFactor("user_id", "identity"),
  secondFactor("label", "identity"),
  secondFactor("credential_id", "technical"),
  secondFactor("public_key", "technical"),
  secondFactor("totp_secret_sealed", "technical"),
  accountRows("second_factor_lockout")("user_id", "identity"),
  // Messages (#69)
  accountRows("notification_preference")("user_id", "identity"),
  accountRows("notification_preference")("email", "preference"),
  accountRows("notification_preference")("sms", "preference"),
  rowsOf("message_delivery", {
    subject: { kind: "user", via: "user_id" },
    retention: DELIVERY_LOG,
    onExpiry: "delete_row",
  })("user_id", "identity"),
  ...(["user_id", "title", "body"] as const).map((column) =>
    rowsOf("inbox_item", {
      subject: { kind: "user", via: "user_id" },
      retention: INBOX_MESSAGE,
      onExpiry: "delete_row",
    })(column, column === "user_id" ? "identity" : "content")
  ),
  capturedMessage("to_address", "contact"),
  capturedMessage("subject", "content"),
  capturedMessage("body_text", "content"),
  capturedMessage("body_html", "content"),
  ...(["aggregate_id", "payload", "last_error"] as const).map((column) =>
    rowsOf("outbox", {
      subject: { kind: "user", via: "payload" },
      retention: BACKGROUND_JOB,
      onExpiry: "delete_row",
    })(column, "technical")
  ),
  // Consent (#64)
  rowsOf("consent_event", {
    subject: { kind: "consent_subject", via: "subject_id" },
    retention: CONSENT_RECORD,
    onExpiry: "retain",
  })("subject_id", "identity"),
  rowsOf("consent_event", {
    subject: { kind: "user", via: "giver_user_id" },
    retention: CONSENT_RECORD,
    onExpiry: "set_null",
  })("giver_user_id", "identity"),
  rowsOf("consent_event", {
    subject: { kind: "consent_subject", via: "subject_id" },
    retention: {
      ...CONSENT_RECORD,
      periodKey: "consentRecords.competition",
    },
    onExpiry: "retain",
  })("competition_id", "technical"),
  // Files (#63)
  rowsOf("file_asset", {
    subject: { kind: "user", via: "owner_user_id" },
    retention: WHILE_FILE_KEPT,
    onExpiry: "delete_row",
  })("owner_user_id", "identity"),
  // Staff who made or changed a record
  ...(
    [
      ["competition", "created_by_user_id"],
      ["competition_award_scheme", "updated_by_user_id"],
      ["competition_consent_document", "attached_by_user_id"],
      ["competition_fee", "updated_by_user_id"],
      ["rubric", "created_by_user_id"],
      ["rubric", "published_by_user_id"],
      ["message_template", "updated_by_user_id"],
      ["setting", "updated_by_user_id"],
    ] as const
  ).map(([table, column]) => actorColumn(table, column, STAFF_RECORD)),
  // Published documents and revisions keep their authorship.
  actorColumn(
    "consent_document",
    "published_by_user_id",
    CONSENT_DOCUMENT_AUTHORSHIP,
    "retain"
  ),
  {
    table: "consent_document",
    column: "body",
    category: "content",
    subject: { kind: "content_subject", via: "body" },
    retention: CONSENT_DOCUMENT_CONTENT,
    onExpiry: "retain",
  },
  actorColumn(
    "cms_revision",
    "created_by_user_id",
    CMS_REVISION_AUTHORSHIP,
    "retain"
  ),
  actorColumn(
    "cms_revision",
    "published_by_user_id",
    CMS_REVISION_AUTHORSHIP,
    "retain"
  ),
  {
    table: "cms_revision",
    column: "body",
    category: "content",
    subject: {
      kind: "content_subject",
      via: "document_id → cms_document.key → body (site_facts: grievanceOfficer.name and grievanceOfficer.email)",
    },
    retention: CMS_REVISION_CONTENT,
    onExpiry: "retain",
  },
  // Institutions (#73)
  institution("contact_email", "contact"),
  institution("contact_phone", "contact"),
  institution("principal_name", "identity"),
  institution("principal_email_ciphertext", "contact"),
  institution("principal_phone_ciphertext", "contact"),
  institution("status_reason", "content"),
  institution("created_by", "identity", {
    subject: { kind: "user", via: "created_by" },
    onExpiry: "retain",
  }),
  institution("verified_by", "identity", {
    subject: { kind: "user", via: "verified_by" },
    onExpiry: "set_null",
  }),
  // Coordinator invitations (#74)
  coordinatorInvitation("identifier_ciphertext", "contact"),
  coordinatorInvitation("identifier_hash", "technical"),
  {
    table: "institution_invitation",
    column: "token_ciphertext",
    category: "technical",
    subject: { kind: "invitee", via: "identifier_hash" },
    retention: WHILE_INVITATION_PENDING,
    onExpiry: "set_null",
  },
  coordinatorInvitation("invited_by_user_id", "identity", {
    subject: { kind: "user", via: "invited_by_user_id" },
  }),
  coordinatorInvitation("accepted_by_user_id", "identity"),
  coordinatorInvitation("revoked_by_user_id", "identity", {
    subject: { kind: "user", via: "revoked_by_user_id" },
  }),
  // Safeguarding reports (#116): only a safeguarding lead reads them
  safeguardingReport("description_ciphertext", "content"),
  safeguardingReport("subject_details_ciphertext", "identity"),
  safeguardingReport("subject_age", "demographic"),
  safeguardingReport("reporter_name_ciphertext", "identity"),
  safeguardingReport("reporter_is_child", "demographic"),
  safeguardingReport("reporter_contact_ciphertext", "contact"),
  safeguardingReport("escalation_reference_ciphertext", "content"),
  safeguardingReport("outcome_ciphertext", "content"),
  safeguardingReport("assigned_to_user_id", "identity", {
    subject: { kind: "user", via: "assigned_to_user_id" },
  }),
  incidentLog("body_ciphertext", "content"),
  incidentLog("author_user_id", "identity", {
    subject: { kind: "user", via: "author_user_id" },
  }),
  // Blog posts and stories (#112)
  ...["body", "easy_read", "excerpt", "seo_title", "slug", "title"].map(
    (column): InventoryField => ({
      table: "cms_post",
      column,
      category: "content",
      subject: { kind: "content_subject", via: column },
      retention: WHILE_POST_EXISTS,
      onExpiry: "delete_row",
    })
  ),
  rowsOf("cms_post_image", {
    subject: { kind: "content_subject", via: "alt" },
    retention: WHILE_POST_EXISTS,
    onExpiry: "delete_row",
  })("alt", "content"),
  {
    table: "cms_post",
    column: "author_name",
    category: "identity",
    subject: { kind: "author", via: "author_name" },
    retention: WHILE_POST_EXISTS,
    onExpiry: "delete_row",
  },
  actorColumn("cms_post", "created_by", WHILE_POST_EXISTS),
  actorColumn("cms_post", "updated_by", WHILE_POST_EXISTS),
  // Institution registrations for a competition (#75)
  actorColumn(
    "institution_registration",
    "registered_by",
    WHILE_REGISTRATION_KEPT
  ),
  // Students an institution enrols (#75)
  profile("full_name", "identity"),
  profile("dob_ciphertext", "demographic"),
  profile("grade", "demographic"),
  profile("student_ref", "identity"),
  profile("phone_ciphertext", "contact"),
  profile("email_ciphertext", "contact"),
  profile("guardian_name_ciphertext", "identity", {
    subject: PROFILE_GUARDIAN_CONTACT,
  }),
  profile("guardian_relationship", "demographic", {
    subject: PROFILE_GUARDIAN_CONTACT,
  }),
  profile("guardian_phone_ciphertext", "contact", {
    subject: PROFILE_GUARDIAN_CONTACT,
  }),
  profile("guardian_email_ciphertext", "contact", {
    subject: PROFILE_GUARDIAN_CONTACT,
  }),
  profile("address_ciphertext", "contact"),
  profile("pin_code", "demographic"),
  profile("city", "demographic"),
  profile("state", "demographic"),
  profile("identity_hash", "technical"),
  profile("created_by", "identity", {
    subject: { kind: "user", via: "created_by" },
    onExpiry: "set_null",
  }),
  // Adults who register themselves (#78): their own profile
  profile("owner_user_id", "identity", { onExpiry: "set_null" }),
  profile("participant_code", "identity"),
  profile("country", "demographic"),
  profile("school_name", "demographic"),
  // Registrations (#75, #78): an entry names the participant and age group.
  registration("participant_profile_id", "identity"),
  registration("age_group_id", "demographic"),
  registration("registration_number", "identity"),
  // Fee payments (#77). Webhook events keep no body: it carries the payer's
  // email and phone.
  payment("payment_batch", "payer_user_id")("payer_user_id", "identity"),
  // Offline payments and payments needing review (#79).
  payment("offline_payment", "batch_id")("reference", "financial", {
    onExpiry: "tombstone",
  }),
  {
    table: "offline_payment",
    column: "proof_file_asset_id",
    category: "financial",
    subject: { kind: "payer", via: "batch_id" },
    retention: PAYMENT_PROOF,
    onExpiry: "retain",
  },
  actorColumn("offline_payment", "recorded_by_user_id", PAYMENT_RECORD),
  payment("payment_review_case", "batch_id")("resolution_reason", "content", {
    onExpiry: "tombstone",
  }),
  actorColumn("payment_review_case", "resolved_by_user_id", PAYMENT_RECORD),
  // Refunds (#80): money records, kept as long as the payment they return.
  payment("refund", "batch_id")("reason", "content", { onExpiry: "tombstone" }),
  actorColumn("refund", "requested_by", PAYMENT_RECORD),
  actorColumn("refund", "decided_by", PAYMENT_RECORD),
  payment("refund", "batch_id")("decision_note", "content"),
  payment("refund", "batch_id")("manual_reference", "financial", {
    onExpiry: "tombstone",
  }),
  actorColumn("refund", "manual_recorded_by", PAYMENT_RECORD),
  // The ledger keeps finance authorship and text that may name people (#105).
  actorColumn("ledger_posting", "created_by_user_id", LEDGER_RECORD, "retain"),
  ...(
    [
      ["ledger_account", "name", LEDGER_CATEGORY],
      ["ledger_account", "public_label", LEDGER_CATEGORY],
      ["ledger_posting", "description", LEDGER_RECORD],
      ["ledger_line", "memo", LEDGER_RECORD],
    ] as const
  ).map(([table, column, retention]): InventoryField => ({
    table,
    column,
    category: "content",
    subject: { kind: "content_subject", via: column },
    retention,
    onExpiry: "retain",
  })),
  // Guardians and their children (#81). A child's profile is a
  // participant_profile row (owner_kind guardian), listed above.
  guardian("user_id", "identity"),
  guardian("full_name_ciphertext", "identity"),
  guardian("phone_ciphertext", "contact"),
  guardian("phone_hash", "technical"),
  guardian("adult_declared_at", "demographic"),
  guardian("verified_at", "technical"),
  guardianLink("relationship", "demographic"),
  guardianLink("guardian_id", "identity", { subject: GUARDIAN_ACCOUNT }),
  guardianLink("participant_profile_id", "identity"),
  guardianInvitation("contact_ciphertext", "contact", {
    subject: GUARDIAN_INVITATION_RECIPIENT,
  }),
  guardianInvitation("contact_hash", "technical", {
    subject: GUARDIAN_INVITATION_RECIPIENT,
  }),
  {
    table: "guardian_invitation",
    column: "token_ciphertext",
    category: "technical",
    subject: { kind: "participant_profile", via: "participant_profile_id" },
    retention: {
      ...WHILE_INVITATION_PENDING,
      policy: "guardianInvitationLinks",
      periodKey: "guardianInvitationLinks",
    },
    onExpiry: "set_null",
  },
  guardianInvitation("accepted_by_user_id", "identity", {
    subject: { kind: "user", via: "accepted_by_user_id" },
  }),
  guardianInvitation("guardian_id", "identity", { subject: GUARDIAN_ACCOUNT }),
  guardianInvitation("participant_profile_id", "identity"),
  rowsOf("guardian_invitation", {
    subject: GUARDIAN_INVITATION_RECIPIENT,
    retention: AFTER_GUARDIAN_REQUEST_CLOSES,
    onExpiry: "delete_row",
  })("invitee_name_ciphertext", "identity"),
  rowsOf("guardian_invitation", {
    subject: { kind: "user", via: "requested_by_user_id" },
    retention: AFTER_GUARDIAN_REQUEST_CLOSES,
    onExpiry: "delete_row",
  })("relationship", "demographic"),
  rowsOf("guardian_invitation", {
    subject: { kind: "user", via: "requested_by_user_id" },
    retention: AFTER_GUARDIAN_REQUEST_CLOSES,
    onExpiry: "delete_row",
  })("requested_by_user_id", "identity"),
  profile("login_user_id", "identity", {
    subject: { kind: "user", via: "login_user_id" },
    onExpiry: "set_null",
  }),
];

const fieldsWithRetentionMessages = INVENTORY_FIELDS.map<InventoryViewEntry>(
  ({ retention: { periodKey, ...retention }, ...field }) => ({
    ...field,
    purpose: PURPOSES[field.table]?.[field.column] ?? "",
    retention: { ...retention, period: PERIOD_TEXT[periodKey] },
    retentionMessage: { key: periodKey },
  })
);

/** The field catalogue for retention policy consumers. */
export const DATA_INVENTORY: readonly InventoryEntry[] = [
  ...fieldsWithRetentionMessages.map(
    ({ retentionMessage: _retentionMessage, ...entry }) => entry
  ),
  ...CONTACT_INVENTORY,
];

export const INVENTORY_VIEW_ENTRIES: readonly InventoryViewEntry[] = [
  ...fieldsWithRetentionMessages,
  ...CONTACT_INVENTORY.map<InventoryViewEntry>((entry) => ({
    ...entry,
    retentionMessage: {
      key: "contactMessages",
      values: { months: MONTHS_AFTER_CLOSE },
    },
  })),
];
