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
// Each entry names its retention policy (./policies): a policy the daily
// sweep enforces, or a lifecycle the data follows instead (deleted with
// the account, kept with the record). The periods are defaults pending
// counsel confirmation (HR-31).

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

/** A directory listing (#127): an organisation's, or an individual's own. */
const WHILE_LISTED = {
  policy: "directoryListings",
  periodKey: "directoryListings",
  basis:
    "FOA shows people where to find help for an animal, and answers for what it verified and published",
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

/**
 * src/server/modules/breaches/retention-policy.ts picks the breaches past
 * it for #114's sweep, which deletes each with its timeline and notices.
 */
const BREACH_RECORD = {
  policy: "breachRecords",
  periodKey: "breachRecords",
  basis:
    "Legal obligation: FOA shows the Data Protection Board what it knew, did and told whom about a personal data breach (legal basis to confirm)",
  toConfirm: true,
} as const;

/**
 * A volunteer application (#123): a closed one that wasn't approved goes a
 * year after it closed; an approved one stays while the person volunteers.
 */
const VOLUNTEER_APPLICATION_RECORD = {
  policy: "volunteerApplications",
  periodKey: "volunteerApplications",
  basis:
    "Child protection: shows who applied to work near children, what they declared, who approved them and why anyone was declined (legal basis to confirm, HR-55)",
  toConfirm: true,
} as const;

/**
 * An adoption application (#130) and its success story: deleted 2 years
 * after the application closed, unless a published story still rests on
 * it.
 */
const ADOPTION_APPLICATION_RECORD = {
  policy: "adoptionApplications",
  periodKey: "adoptionApplications",
  basis:
    "Facilitating an adoption: lets FOA's coordinator and the listing organisation match the adopter, and answer later questions about the adoption (legal basis to confirm, HR-31)",
  toConfirm: true,
} as const;

const LEGAL_HOLD = {
  policy: "releasedLegalHolds",
  periodKey: "releasedLegalHolds",
  basis:
    "Records why FOA must keep a person's records past their retention, and who decided it",
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

/** Announcements to registrants (#84): kept with the competition's records. */
const ANNOUNCEMENT_RECORD = {
  policy: "announcements",
  periodKey: "announcements",
  basis:
    "Shows FOA who wrote and who sent each announcement, and lets it answer questions about the instructions and help contacts it sent",
  toConfirm: true,
} as const;

/** Donations (#106): money records, with the donor as they gave. */
const DONATION_RECORD = {
  policy: "donationRecords",
  periodKey: "donationRecords",
  basis:
    "Financial records: FOA answers for each donation and its receipt to the donor, its auditors and the tax authorities",
  toConfirm: true,
} as const;

/** Campaigns (#126): who wrote and sent each, and who each message went to. */
const CAMPAIGN_RECORD = {
  policy: "campaigns",
  periodKey: "campaigns",
  basis:
    "Shows FOA who wrote and sent each campaign and who it reached on which consent, and lets a withdrawal by link find them",
  toConfirm: true,
} as const;

/** A competition-scoped consent: what a signed form or code link recorded. */
const COMPETITION_CONSENT_RECORD = {
  ...CONSENT_RECORD,
  periodKey: "consentRecords.competition",
} as const;

/** Signed consent forms (#83): the scan, its scope and its review. */
const SIGNED_FORM_RECORD = {
  policy: "signedConsentForms",
  periodKey: "signedConsentForms",
  basis: "Lets FOA check the signed evidence and account for its review",
  toConfirm: true,
} as const;

/** A guardian code link's delivery contact (#83). */
const AFTER_CONSENT_LINK_CLOSES = {
  policy: "consentLinkContacts",
  periodKey: "consentLinkContacts",
  basis:
    "Reaches the guardian contact and helps FOA answer queries about link delivery",
  toConfirm: true,
} as const;

/** A guardian code link's single-use secrets (#83). */
const WHILE_CONSENT_LINK_OPEN = {
  policy: "consentLinkSecrets",
  periodKey: "consentLinkSecrets",
  basis:
    "Provides a single-use link and verifies control of the contact before recording choices",
  toConfirm: true,
} as const;

/** Competition entries (#85): the work, its words and its history. */
const ENTRY_RECORD = {
  policy: "entries",
  periodKey: "entries",
  basis:
    "Lets participants and FOA find the submitted work, resolve questions and review judging or upload history",
  toConfirm: true,
} as const;

const ENTRY_MEDIA = {
  policy: "entryMedia",
  periodKey: "entryMedia",
  basis:
    "Keeps private originals for processing and metadata-stripped copies for review and appeals",
  toConfirm: true,
} as const;

const ENTRY_UPLOAD_GRANT = {
  policy: "entryUploadGrants",
  periodKey: "entryUploadGrants",
  basis: "Confirms and rate-limits uploads and removes unused staged data",
  toConfirm: true,
} as const;

const ENTRY_PENDING_TEXT = {
  policy: "entryPendingText",
  periodKey: "entryPendingText",
  basis:
    "Publishes the text with its approved image and discards unused revisions",
  toConfirm: true,
} as const;

/** Privacy rights requests (#115): kept 3 years after they close. */
const PRIVACY_REQUEST_RECORD = {
  policy: "privacyRequests",
  periodKey: "privacyRequests",
  basis:
    "FOA shows what a person asked under their data rights and how and when it answered (DPDP Act 2023; HR-30)",
  toConfirm: true,
} as const;

/** Erasure records (#115b): kept as the proof of each erasure. */
const ERASURE_RECORD = {
  policy: "erasureRecords",
  periodKey: "erasureRecords",
  basis:
    "FOA shows it erased what a person asked, and erases it again if a backup is restored (DPDP Act 2023; HR-30)",
  toConfirm: true,
} as const;

const privacyRequestColumn = rowsOf("privacy_request", {
  subject: { kind: "user", via: "subject_kind + subject_id" },
  retention: PRIVACY_REQUEST_RECORD,
  onExpiry: "delete_row",
});

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

const listing = rowsOf("directory_listing", {
  subject: { kind: "directory_listing", via: "id" },
  retention: WHILE_LISTED,
  onExpiry: "delete_row",
});

/** An adoption listing (#129) lives and goes with its directory listing. */
const adoptable = rowsOf("adoption_listing", {
  subject: { kind: "directory_listing", via: "directory_listing_id" },
  retention: WHILE_LISTED,
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

/** A breach's rows go with the breach (ON DELETE CASCADE). */
const breachRows = (table: string, subject: Subject) =>
  rowsOf(table, { subject, retention: BREACH_RECORD, onExpiry: "delete_row" });

const breach = breachRows("breach_record", {
  kind: "breach_affected",
  via: "id",
});

const breachTimeline = breachRows("breach_timeline_event", {
  kind: "breach_affected",
  via: "breach_id",
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

const volunteerApplication = rowsOf("volunteer_application", {
  subject: { kind: "user", via: "applicant_user_id" },
  retention: VOLUNTEER_APPLICATION_RECORD,
  onExpiry: "delete_row",
});

const adoptionApplication = rowsOf("adoption_application", {
  subject: { kind: "user", via: "applicant_user_id" },
  retention: ADOPTION_APPLICATION_RECORD,
  onExpiry: "delete_row",
});

/** A success story goes with its application. */
const adoptionStory = rowsOf("adoption_story", {
  subject: { kind: "adoption_application", via: "application_id" },
  retention: ADOPTION_APPLICATION_RECORD,
  onExpiry: "delete_row",
});

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

const signedForm = rowsOf("consent_form", {
  subject: { kind: "participant_profile", via: "participant_profile_id" },
  retention: SIGNED_FORM_RECORD,
  onExpiry: "delete_row",
});

/** A code link's fields follow the consent it records unless they say otherwise. */
function consentLink(
  column: string,
  category: PersonalDataCategory,
  overrides: Partial<Pick<InventoryField, "retention" | "onExpiry">> = {}
): InventoryField {
  return {
    table: "consent_link",
    column,
    category,
    subject: { kind: "participant_profile", via: "participant_profile_id" },
    retention: COMPETITION_CONSENT_RECORD,
    onExpiry: "delete_row",
    ...overrides,
  };
}

const entry = rowsOf("entry", {
  subject: { kind: "participant_profile", via: "participant_profile_id" },
  retention: ENTRY_RECORD,
  onExpiry: "delete_row",
});

const ENTRY_PARTICIPANT = {
  kind: "participant_profile",
  via: "entry_id → entry.participant_profile_id",
};

/** An upload attempt: kept with the entry, its file only until the media go. */
function entryFile(
  column: string,
  category: PersonalDataCategory,
  overrides: Partial<Pick<InventoryField, "retention" | "onExpiry">> = {}
): InventoryField {
  return {
    table: "entry_file",
    column,
    category,
    subject: ENTRY_PARTICIPANT,
    retention: ENTRY_RECORD,
    onExpiry: "delete_row",
    ...overrides,
  };
}

const JUDGING_RECORD = {
  policy: "judgingRecords",
  periodKey: "judgingRecords",
  basis:
    "FOA reviews judge invitations, declarations and conflicts and records their round assignments",
  toConfirm: true,
} as const;
const judgeInvite = rowsOf("judge_invitation", {
  subject: { kind: "invitee", via: "email_hash" },
  retention: JUDGING_RECORD,
  onExpiry: "delete_row",
});
const judgeDeclaration = rowsOf("judge_onboarding", {
  subject: { kind: "user", via: "judge_user_id" },
  retention: JUDGING_RECORD,
  onExpiry: "delete_row",
});
const judgeConflictRecord = rowsOf("judge_conflict", {
  subject: { kind: "user", via: "judge_user_id" },
  retention: JUDGING_RECORD,
  onExpiry: "delete_row",
});
const INVENTORY_FIELDS: readonly InventoryField[] = [
  ...[
    "participant_profile_id",
    "registration_id",
    "number",
    "name_snapshot",
    "award_position",
    "award_label",
    "type",
    "revoked_reason",
    "pdf_file_id",
  ].map((c) =>
    rowsOf("certificate", {
      subject: { kind: "participant_profile", via: "participant_profile_id" },
      retention: JUDGING_RECORD,
      onExpiry: "delete_row",
    })(
      c,
      c === "name_snapshot" || c === "participant_profile_id"
        ? "identity"
        : "content"
    )
  ),
  actorColumn("certificate", "revoked_by_user_id", STAFF_RECORD),
  rowsOf("certificate_ready_notice", {
    subject: { kind: "user", via: "recipient_user_id" },
    retention: JUDGING_RECORD,
    onExpiry: "delete_row",
  })("recipient_user_id", "identity"),
  ...[
    "created_by_user_id",
    "opened_by_user_id",
    "cancelled_by_user_id",
    "locked_by_user_id",
  ].map((c) => actorColumn("judging_round", c, STAFF_RECORD)),
  actorColumn("result_release", "prepared_by_user_id", STAFF_RECORD),
  actorColumn("result_release", "approved_by_user_id", STAFF_RECORD),
  ...[
    "outcome",
    "award_position",
    "award_band",
    "prize",
    "suitable_for_auction",
  ].map((c) =>
    rowsOf("result_award", {
      subject: ENTRY_PARTICIPANT,
      retention: JUDGING_RECORD,
      onExpiry: "delete_row",
    })(c, "content")
  ),
  actorColumn("round_entry", "admitted_by_user_id", STAFF_RECORD),
  ...[
    "code",
    "rank",
    "score_numerator",
    "score_denominator",
    "outcome",
    "award_position",
    "suitable_for_auction",
  ].map((c) =>
    rowsOf("round_result", {
      subject: ENTRY_PARTICIPANT,
      retention: JUDGING_RECORD,
      onExpiry: "delete_row",
    })(c, c === "code" ? "identity" : "content")
  ),
  actorColumn("round_assignment", "assigned_by_user_id", STAFF_RECORD),
  rowsOf("round_assignment", {
    subject: { kind: "user", via: "judge_user_id" },
    retention: JUDGING_RECORD,
    onExpiry: "delete_row",
  })("judge_user_id", "identity"),
  rowsOf("score_sheet", {
    subject: { kind: "user", via: "judge_user_id" },
    retention: JUDGING_RECORD,
    onExpiry: "delete_row",
  })("judge_user_id", "identity"),
  rowsOf("score_sheet", {
    subject: ENTRY_PARTICIPANT,
    retention: JUDGING_RECORD,
    onExpiry: "delete_row",
  })("comment", "content"),
  rowsOf("criterion_score", {
    subject: {
      kind: "participant_profile",
      via: "score_sheet_id → score_sheet.entry_id → entry.participant_profile_id",
    },
    retention: JUDGING_RECORD,
    onExpiry: "delete_row",
  })("value", "content"),
  judgeInvite("email_ciphertext", "contact"),
  judgeInvite("email_hash", "technical"),
  judgeInvite("token_ciphertext", "technical", { onExpiry: "set_null" }),
  actorColumn("judge_invitation", "invited_by_user_id", STAFF_RECORD),
  judgeInvite("accepted_user_id", "identity"),
  judgeDeclaration("judge_user_id", "identity"),
  judgeDeclaration("conflict_statement", "content"),
  judgeDeclaration("conduct_consent_event_id", "technical"),
  judgeDeclaration("confidentiality_consent_event_id", "technical"),
  judgeConflictRecord("judge_user_id", "identity"),
  judgeConflictRecord("note", "content"),
  actorColumn("judge_conflict", "created_by_user_id", STAFF_RECORD),
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
  // A delivery keyed by destination (#84) names its recipient by blind index.
  ...(
    ["contact_hash", "recipient_account_hash", "recipient_hashes"] as const
  ).map((column) =>
    rowsOf("message_delivery", {
      subject: { kind: "recipient", via: column },
      retention: DELIVERY_LOG,
      onExpiry: "delete_row",
    })(column, "technical")
  ),
  ...(
    ["user_id", "title", "body", "title_ciphertext", "body_ciphertext"] as const
  ).map((column) =>
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
  // Signed forms and code links (#83) as consent evidence.
  ...(["consent_form_id", "consent_link_id"] as const).map((column) =>
    rowsOf("consent_event", {
      subject: { kind: "consent_subject", via: "subject_id" },
      retention: COMPETITION_CONSENT_RECORD,
      onExpiry: "retain",
    })(column, "technical")
  ),
  rowsOf("consent_event", {
    subject: { kind: "consent_giver", via: "giver_contact_hash" },
    retention: COMPETITION_CONSENT_RECORD,
    onExpiry: "retain",
  })("giver_contact_hash", "technical"),
  actorColumn(
    "consent_event",
    "reviewer_user_id",
    COMPETITION_CONSENT_RECORD,
    "retain"
  ),
  // Files (#63)
  ...(["owner_user_id", "storage_key"] as const).map((column) =>
    rowsOf("file_asset", {
      subject: { kind: "user", via: "owner_user_id" },
      retention: WHILE_FILE_KEPT,
      onExpiry: "delete_row",
    })(column, column === "owner_user_id" ? "identity" : "technical")
  ),
  ...(["file_asset_id", "storage_key"] as const).map((column) =>
    rowsOf("file_derivative", {
      subject: {
        kind: "user",
        via: "file_asset_id → file_asset.owner_user_id or certificate.pdf_file_id → certificate.participant_profile_id",
      },
      retention: WHILE_FILE_KEPT,
      onExpiry: "delete_row",
    })(column, "technical")
  ),
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
  // NGO directory listings (#127): an individual rescuer's or foster
  // caregiver's listing is about them, so its details are personal data.
  listing("slug", "identity"),
  listing("name", "identity"),
  listing("description", "content"),
  listing("address_ciphertext", "contact"),
  listing("city", "contact"),
  listing("state", "contact"),
  listing("pin_code", "contact"),
  listing("contact_phone_ciphertext", "contact"),
  listing("contact_email_ciphertext", "contact"),
  listing("website", "contact"),
  listing("public_contact_fields", "preference"),
  listing("status_reason", "content"),
  listing("owner_user_id", "identity", {
    subject: { kind: "user", via: "owner_user_id" },
    onExpiry: "set_null",
  }),
  actorColumn("directory_listing", "status_changed_by_user_id", WHILE_LISTED),
  // Adoption listings (#129): an animal fostered by an individual is
  // where they live, so its location is theirs. The animal's own details
  // are not personal data (non-personal.ts).
  adoptable("state", "contact"),
  adoptable("city", "contact"),
  adoptable("city_key", "contact"),
  adoptable("pin_code", "contact"),
  actorColumn("adoption_listing", "created_by_user_id", WHILE_LISTED),
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
  // The breach log (#116): breach staff (super and staff admins) read it.
  breach("title_ciphertext", "content"),
  breach("impact_ciphertext", "content"),
  breach("authority_reference_ciphertext", "content"),
  breach("lead_user_id", "identity", {
    subject: { kind: "user", via: "lead_user_id" },
  }),
  breachTimeline("note_ciphertext", "content"),
  breachTimeline("author_user_id", "identity", {
    subject: { kind: "user", via: "author_user_id" },
  }),
  breachRows("breach_notification", {
    kind: "user",
    via: "recipient_user_id",
  })("recipient_user_id", "identity"),
  breachRows("breach_notification", {
    kind: "participant_profile",
    via: "guardian_profile_ids",
  })("guardian_profile_ids", "identity"),
  breachRows("breach_fan_out", { kind: "user", via: "after_user_id" })(
    "after_user_id",
    "identity"
  ),
  breachRows("breach_unreachable", {
    kind: "breach_affected",
    via: "subject_type + subject_id",
  })("subject_id", "identity"),
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
  actorColumn(
    "institution_registration",
    "participation_declared_by_user_id",
    WHILE_REGISTRATION_KEPT
  ),
  // Who certified the school's conduct (#87); the audit log keeps it too.
  actorColumn(
    "conduct_certification",
    "certified_by_user_id",
    WHILE_REGISTRATION_KEPT
  ),
  // The school round (#89): who attested, finalised and picked; the
  // judging panel's names and roles (HR-31: retention to confirm).
  actorColumn(
    "school_round",
    "judging_attested_by_user_id",
    WHILE_REGISTRATION_KEPT
  ),
  actorColumn("school_round", "finalised_by_user_id", WHILE_REGISTRATION_KEPT),
  // Who closed an overdue round on the school's behalf (#90).
  actorColumn("school_round", "closed_by_user_id", WHILE_REGISTRATION_KEPT),
  actorColumn(
    "school_round_pick",
    "picked_by_user_id",
    WHILE_REGISTRATION_KEPT
  ),
  actorColumn(
    "school_round_transition",
    "actor_user_id",
    WHILE_REGISTRATION_KEPT
  ),
  // Who made a shortlisted entry's declarations (#91).
  actorColumn(
    "school_round_declaration",
    "declared_by_user_id",
    WHILE_REGISTRATION_KEPT
  ),
  {
    table: "school_round_panel_member",
    column: "full_name",
    category: "identity",
    subject: { kind: "panel_member", via: "id" },
    retention: WHILE_REGISTRATION_KEPT,
    onExpiry: "delete_row",
  },
  {
    table: "school_round_panel_member",
    column: "designation",
    category: "identity",
    subject: { kind: "panel_member", via: "id" },
    retention: WHILE_REGISTRATION_KEPT,
    onExpiry: "delete_row",
  },
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
  // Period locks and two-approver requests (#109): who asked, who decided,
  // and finance's own words (an unlock reason, a manual entry's narration).
  actorColumn("ledger_period", "locked_by_user_id", LEDGER_RECORD, "retain"),
  actorColumn(
    "ledger_period",
    "last_unlocked_by_user_id",
    LEDGER_RECORD,
    "retain"
  ),
  actorColumn(
    "finance_approval",
    "requested_by_user_id",
    LEDGER_RECORD,
    "retain"
  ),
  actorColumn(
    "finance_approval",
    "decided_by_user_id",
    LEDGER_RECORD,
    "retain"
  ),
  // Budgets (#109): who set each one.
  actorColumn("ledger_budget", "created_by_user_id", LEDGER_RECORD, "retain"),
  actorColumn("ledger_budget", "updated_by_user_id", LEDGER_RECORD, "retain"),
  ...(
    [
      ["ledger_account", "name", LEDGER_CATEGORY],
      ["ledger_account", "public_label", LEDGER_CATEGORY],
      ["ledger_posting", "description", LEDGER_RECORD],
      ["ledger_line", "memo", LEDGER_RECORD],
      ["ledger_period", "last_unlock_reason", LEDGER_RECORD],
      ["finance_approval", "payload", LEDGER_RECORD],
      ["finance_approval", "decision_reason", LEDGER_RECORD],
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
  // Signed consent forms (#83): a coordinator submits the scan, staff review it.
  signedForm("participant_profile_id", "identity"),
  signedForm("file_asset_id", "identity"),
  signedForm("competition_id", "technical"),
  signedForm("institution_registration_id", "technical"),
  signedForm("uses", "preference"),
  signedForm("documents", "technical"),
  signedForm("rejection_note", "content"),
  // Both accounts stay on the record: the foreign keys restrict deletion.
  actorColumn(
    "consent_form",
    "uploaded_by_user_id",
    SIGNED_FORM_RECORD,
    "retain"
  ),
  actorColumn(
    "consent_form",
    "reviewed_by_user_id",
    SIGNED_FORM_RECORD,
    "retain"
  ),
  ...(["file_asset_id", "registration_id"] as const).map((column) =>
    rowsOf("consent_form_upload", {
      subject: {
        kind: "participant_profile",
        via: "registration_id → registration.participant_profile_id",
      },
      retention: SIGNED_FORM_RECORD,
      onExpiry: "delete_row",
    })(column, "identity")
  ),
  // Guardian consent by code link (#83). The contact and the token's hash
  // are required columns, so the sweep can't clear them alone: unit 114-2
  // decides how they go after 90 days.
  consentLink("contact_ciphertext", "contact", {
    retention: AFTER_CONSENT_LINK_CLOSES,
    onExpiry: "retain",
  }),
  consentLink("contact_hash", "technical", {
    retention: AFTER_CONSENT_LINK_CLOSES,
    onExpiry: "retain",
  }),
  consentLink("token_hash", "technical", {
    retention: AFTER_CONSENT_LINK_CLOSES,
    onExpiry: "retain",
  }),
  ...(["token_ciphertext", "code_hash", "session_token_hash"] as const).map(
    (column) =>
      consentLink(column, "technical", {
        retention: WHILE_CONSENT_LINK_OPEN,
        onExpiry: "set_null",
      })
  ),
  consentLink("answers", "preference"),
  consentLink("offered_uses", "technical"),
  consentLink("participant_profile_id", "identity"),
  consentLink("student_registration_id", "identity"),
  consentLink("institution_registration_id", "technical"),
  consentLink("competition_id", "technical"),
  actorColumn("consent_link", "sent_by_user_id", COMPETITION_CONSENT_RECORD),
  // Competition entries (#85): the work, its uploads and its history.
  entry("code", "identity"),
  entry("registration_id", "identity"),
  entry("participant_profile_id", "identity"),
  entry("title", "content"),
  entry("description", "content"),
  entry("statement", "content"),
  actorColumn("entry", "created_by_user_id", ENTRY_RECORD),
  entryFile("id", "technical"),
  entryFile("entry_id", "identity"),
  entryFile("file_asset_id", "content", {
    retention: ENTRY_MEDIA,
    onExpiry: "set_null",
  }),
  entryFile("pending_text", "content", {
    retention: ENTRY_PENDING_TEXT,
    onExpiry: "set_null",
  }),
  entryFile("receipt_title", "content"),
  // A typed essay is the work itself (#86), kept like the entry's words.
  entryFile("essay_body", "content"),
  actorColumn("entry_file", "uploaded_by_user_id", ENTRY_RECORD),
  ...(["file_asset_id", "registration_id", "upload_key"] as const).map(
    (column) =>
      rowsOf("entry_upload_grant", {
        subject: {
          kind: "participant_profile",
          via: "registration_id → registration.participant_profile_id",
        },
        retention: ENTRY_UPLOAD_GRANT,
        onExpiry: "delete_row",
      })(column, column === "registration_id" ? "identity" : "technical")
  ),
  ...(["entry_id", "entry_file_id"] as const).map((column) =>
    rowsOf("entry_transition", {
      subject: ENTRY_PARTICIPANT,
      retention: ENTRY_RECORD,
      onExpiry: "delete_row",
    })(column, "technical")
  ),
  actorColumn("entry_transition", "actor_user_id", ENTRY_RECORD),
  rowsOf("entry_verification", {
    subject: ENTRY_PARTICIPANT,
    retention: ENTRY_RECORD,
    onExpiry: "delete_row",
  })("entry_id", "technical"),
  rowsOf("entry_verification", {
    subject: ENTRY_PARTICIPANT,
    retention: ENTRY_RECORD,
    onExpiry: "delete_row",
  })("reason_text", "content"),
  actorColumn("entry_verification", "decided_by_user_id", ENTRY_RECORD),
  actorColumn("entry_verification", "resubmitted_by_user_id", ENTRY_RECORD),
  ...(
    [
      "entry_id",
      "registration_id",
      "institution_registration_id",
      "artwork_code",
      "courier_name",
      "tracking_number",
    ] as const
  ).map((column) =>
    rowsOf("physical_artwork", {
      subject: ENTRY_PARTICIPANT,
      retention: ENTRY_RECORD,
      onExpiry: "delete_row",
    })(
      column,
      column === "courier_name" || column === "tracking_number"
        ? "content"
        : "identity"
    )
  ),
  actorColumn("physical_artwork", "requested_by", ENTRY_RECORD),
  actorColumn("physical_artwork", "dispatched_by", ENTRY_RECORD),
  actorColumn("physical_artwork", "received_by", ENTRY_RECORD),
  rowsOf("physical_artwork", {
    subject: ENTRY_PARTICIPANT,
    retention: ENTRY_RECORD,
    onExpiry: "delete_row",
  })("storage_location", "content"),
  ...(
    [
      ["artwork_verification", ["artwork_id", "condition_notes", "material"]],
      ["artwork_photo", ["artwork_id", "file_asset_id"]],
      ["artwork_discrepancy", ["artwork_id", "notes", "resolution"]],
      ["artwork_custody_event", ["artwork_id", "location", "return_via"]],
      ["artwork_return_request", ["artwork_id", "via"]],
    ] as const
  ).flatMap(([table, columns]) =>
    columns.map((column) =>
      rowsOf(table, {
        subject: {
          kind: "participant_profile",
          via: "artwork_id → physical_artwork.entry_id → entry.participant_profile_id",
        },
        retention: ENTRY_RECORD,
        onExpiry: "delete_row",
      })(
        column,
        column === "artwork_id" || column === "file_asset_id"
          ? "technical"
          : "content"
      )
    )
  ),
  actorColumn("artwork_verification", "verified_by", ENTRY_RECORD),
  actorColumn("artwork_photo", "created_by", ENTRY_RECORD),
  actorColumn("artwork_discrepancy", "raised_by", ENTRY_RECORD),
  actorColumn("artwork_discrepancy", "resolved_by", ENTRY_RECORD),
  actorColumn(
    "artwork_custody_event",
    "actor_user_id",
    ENTRY_RECORD,
    "delete_row"
  ),
  actorColumn("artwork_return_request", "requested_by", ENTRY_RECORD),
  // Auction lots (#131): a creator's submitted work and auction consent.
  ...(
    [
      "artwork_id",
      "consent_event_id",
      "lot_code",
      "story",
      "cancellation_reason",
    ] as const
  ).map((column) =>
    rowsOf("auction_lot", {
      subject: {
        kind: "participant_profile",
        via: "artwork_id → physical_artwork.entry_id → entry.participant_profile_id",
      },
      retention: ENTRY_RECORD,
      onExpiry: "delete_row",
    })(
      column,
      column === "story" || column === "cancellation_reason"
        ? "content"
        : "technical"
    )
  ),
  actorColumn("auction_lot", "created_by", ENTRY_RECORD),
  ...(
    ["bidder_user_id", "amount_paise", "declaration_version", "lot_id"] as const
  ).map((column) =>
    rowsOf("auction_bid", {
      subject: { kind: "user", via: "bidder_user_id" },
      retention: {
        policy: "auctionBids",
        periodKey: "auctionBids",
        basis:
          "Records the buyer's accepted bids and adult declaration, so FOA can settle a lot and answer disputes. The account link is cleared when the bidder is erased; the price history cannot be lowered by erasure.",
        toConfirm: true,
      },
      onExpiry: column === "bidder_user_id" ? "set_null" : "retain",
    })(
      column,
      column === "bidder_user_id"
        ? "identity"
        : column === "amount_paise"
          ? "financial"
          : "technical"
    )
  ),
  // Announcements to registrants (#84): help contacts and staff accounts.
  {
    table: "announcement",
    column: "help_contacts_ciphertext",
    category: "contact",
    subject: { kind: "content_subject", via: "help_contacts_ciphertext" },
    retention: ANNOUNCEMENT_RECORD,
    onExpiry: "delete_row",
  },
  actorColumn("announcement", "created_by", ANNOUNCEMENT_RECORD),
  actorColumn("announcement", "sent_by", ANNOUNCEMENT_RECORD),
  // Campaigns (#126): staff accounts, and each message's recipient and the
  // consents it rested on.
  actorColumn("campaign", "created_by", CAMPAIGN_RECORD),
  actorColumn("campaign", "sent_by", CAMPAIGN_RECORD),
  rowsOf("campaign_recipient", {
    subject: { kind: "user", via: "user_id" },
    retention: CAMPAIGN_RECORD,
    onExpiry: "delete_row",
  })("user_id", "identity"),
  rowsOf("campaign_recipient", {
    subject: { kind: "consent_subject", via: "bases" },
    retention: CAMPAIGN_RECORD,
    onExpiry: "delete_row",
  })("bases", "identity"),
  // Legal holds (#114): a released hold stays as the record of who held
  // what and why, until the releasedLegalHolds policy deletes it.
  ...(
    [
      ["subject_id", "identity"],
      ["reason", "content"],
    ] as const
  ).map(([column, category]) =>
    rowsOf("legal_hold", {
      subject: { kind: "held_subject", via: "subject_type, subject_id" },
      retention: LEGAL_HOLD,
      onExpiry: "delete_row",
    })(column, category)
  ),
  actorColumn("legal_hold", "placed_by_user_id", LEGAL_HOLD),
  actorColumn("legal_hold", "released_by_user_id", LEGAL_HOLD),
  // Donations (#106): the donor as they gave, the wall name they chose,
  // and the receipt that froze their name. Kept as financial records.
  ...(
    [
      ["user_id", "identity", "set_null"],
      ["name_ciphertext", "identity", "retain"],
      ["email_ciphertext", "contact", "retain"],
      ["email_hash", "contact", "retain"],
      ["organisation_name", "identity", "retain"],
      ["pan_ciphertext", "financial", "retain"],
    ] as const
  ).map(([column, category, onExpiry]) =>
    rowsOf("donor", {
      subject: { kind: "donor", via: "id" },
      retention: DONATION_RECORD,
      onExpiry,
    })(column, category)
  ),
  rowsOf("donation", {
    subject: { kind: "donor", via: "donor_id" },
    retention: DONATION_RECORD,
    onExpiry: "set_null",
  })("wall_name", "identity"),
  ...(["offline_reference", "offline_proof_file_id"] as const).map((column) =>
    rowsOf("donation", {
      subject: { kind: "donor", via: "donor_id" },
      retention: DONATION_RECORD,
      onExpiry: "retain",
    })(column, "financial")
  ),
  actorColumn("donation", "offline_recorded_by", DONATION_RECORD),
  rowsOf("receipt", {
    subject: { kind: "donor", via: "donation_id" },
    retention: DONATION_RECORD,
    onExpiry: "retain",
  })("snapshot", "identity"),
  actorColumn("receipt_link", "created_by_user_id", DONATION_RECORD),
  rowsOf("recurring_donation", {
    subject: { kind: "donor", via: "donor_id" },
    retention: DONATION_RECORD,
    onExpiry: "set_null",
  })("wall_name", "identity"),
  actorColumn("recurring_donation", "user_id", DONATION_RECORD),
  // Privacy rights requests (#115): who asked about whom, and the words
  // the requester and the grievance officer wrote, encrypted.
  privacyRequestColumn("subject_id", "identity"),
  privacyRequestColumn("requested_by_user_id", "identity", {
    subject: { kind: "user", via: "requested_by_user_id" },
  }),
  privacyRequestColumn("correction_details_ciphertext", "content"),
  privacyRequestColumn("rejection_reason_ciphertext", "content"),
  privacyRequestColumn("resolution_ciphertext", "content"),
  actorColumn("privacy_request", "assigned_to_user_id", PRIVACY_REQUEST_RECORD),
  actorColumn(
    "privacy_request",
    "erasure_approved_by_user_id",
    PRIVACY_REQUEST_RECORD
  ),
  rowsOf("privacy_request_note", {
    subject: {
      kind: "user",
      via: "request_id → privacy_request.subject_kind + subject_id",
    },
    retention: PRIVACY_REQUEST_RECORD,
    onExpiry: "delete_row",
  })("body_ciphertext", "content"),
  actorColumn("privacy_request_note", "author_user_id", PRIVACY_REQUEST_RECORD),
  // Erasure records (#115b): ids of the accounts and profiles erased.
  ...(["subject_id", "user_ids", "profile_ids"] as const).map((column) =>
    rowsOf("erasure_record", {
      subject: {
        kind: "user",
        via: "subject_kind + subject_id, user_ids, profile_ids",
      },
      retention: ERASURE_RECORD,
      onExpiry: "retain",
    })(column, "identity")
  ),
  // Volunteer applications (#123): the applicant's answers and the record
  // of who vetted them.
  volunteerApplication("applicant_user_id", "identity"),
  volunteerApplication("participant_profile_id", "identity"),
  volunteerApplication("date_of_birth_ciphertext", "demographic"),
  volunteerApplication("interests", "preference"),
  volunteerApplication("availability", "preference"),
  volunteerApplication("guardian_user_id", "identity", {
    subject: { kind: "user", via: "guardian_user_id" },
  }),
  volunteerApplication("safeguarding_consent_id", "technical"),
  volunteerApplication("conduct_consent_id", "technical"),
  volunteerApplication("decline_reason_ciphertext", "content"),
  actorColumn(
    "volunteer_application",
    "decided_by_user_id",
    VOLUNTEER_APPLICATION_RECORD,
    "delete_row"
  ),
  adoptionApplication("applicant_user_id", "identity"),
  adoptionApplication("participant_profile_id", "identity"),
  adoptionApplication("date_of_birth_ciphertext", "demographic"),
  adoptionApplication("phone_ciphertext", "contact"),
  adoptionApplication("address_ciphertext", "contact"),
  adoptionApplication("answers_ciphertext", "content"),
  adoptionApplication("contact_sharing_consent_id", "technical"),
  adoptionApplication("outcome_reason_ciphertext", "content"),
  actorColumn(
    "adoption_application",
    "decided_by_user_id",
    ADOPTION_APPLICATION_RECORD
  ),
  adoptionStory("body", "content"),
  adoptionStory("consent_event_id", "technical"),
  actorColumn(
    "adoption_story",
    "published_by_user_id",
    ADOPTION_APPLICATION_RECORD
  ),
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
