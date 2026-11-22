// The data inventory: every database column that holds personal data, what
// FOA keeps it for, and how long. Each ticket that adds such a column adds
// its entries here; ./inventory.test.ts fails while an encrypted column is
// missing. docs/privacy/data-inventory.md explains the list. Retention
// periods are defaults until counsel confirms them (HR-31), so every entry
// says `toConfirm: true`.
//
// Loads under plain Node: no imports.

export type InventoryEntry = {
  table: string;
  column: string;
  /** What FOA keeps it for. */
  purpose: string;
  retention: {
    /** How long, in words a person reads. */
    period: string;
    /** Why it is kept that long. */
    basis: string;
    /** True until counsel confirms the period. */
    toConfirm: true;
  };
};

const WHILE_ACCOUNT_OPEN = {
  period: "While the account is open",
  basis: "Needed to sign the person in and reach them about their account",
  toConfirm: true,
} as const;

const WHILE_INSTITUTION_TAKES_PART = {
  period:
    "While the institution takes part, then 3 years after its last competition",
  basis:
    "FOA reaches the institution about its competitions, and answers queries about past results",
  toConfirm: true,
} as const;

/**
 * src/server/modules/safeguarding/domain/retention.ts computes this date;
 * src/server/modules/safeguarding/retention-policy.ts picks the reports
 * past it for #114's sweep, which deletes each with its incident log.
 */
const SAFEGUARDING_RECORD = {
  period:
    "While the report is open, then 7 years after it is resolved or until " +
    "the child concerned turns 25, whichever is later",
  basis:
    "Child protection: the record of what was reported and done, kept for " +
    "the child, FOA and the authorities (legal basis to confirm)",
  toConfirm: true,
} as const;

export const DATA_INVENTORY: readonly InventoryEntry[] = [
  // Accounts (#57, #58)
  {
    table: "user",
    column: "name",
    purpose: "Greets the person and names them to staff",
    retention: WHILE_ACCOUNT_OPEN,
  },
  {
    table: "user",
    column: "email",
    purpose: "Signs the person in by email code and sends their messages",
    retention: WHILE_ACCOUNT_OPEN,
  },
  {
    table: "user",
    column: "phone_ciphertext",
    purpose: "Signs the person in by SMS code (encrypted)",
    retention: WHILE_ACCOUNT_OPEN,
  },
  // Institutions (#73)
  {
    table: "institution",
    column: "contact_email",
    purpose: "Reaches the institution's office about its registration",
    retention: WHILE_INSTITUTION_TAKES_PART,
  },
  {
    table: "institution",
    column: "contact_phone",
    purpose: "Reaches the institution's office about its registration",
    retention: WHILE_INSTITUTION_TAKES_PART,
  },
  {
    table: "institution",
    column: "principal_name",
    purpose: "Names the head of the institution FOA verifies it with",
    retention: WHILE_INSTITUTION_TAKES_PART,
  },
  {
    table: "institution",
    column: "principal_email_ciphertext",
    purpose:
      "Lets FOA staff confirm the registration with the principal (encrypted)",
    retention: WHILE_INSTITUTION_TAKES_PART,
  },
  {
    table: "institution",
    column: "principal_phone_ciphertext",
    purpose:
      "Lets FOA staff confirm the registration with the principal (encrypted)",
    retention: WHILE_INSTITUTION_TAKES_PART,
  },
  {
    table: "institution",
    column: "created_by",
    purpose:
      "Links the institution to its authorised person, who becomes its admin",
    retention: WHILE_INSTITUTION_TAKES_PART,
  },
  {
    table: "institution",
    column: "verified_by",
    purpose: "Records which FOA staff member verified the institution",
    retention: WHILE_INSTITUTION_TAKES_PART,
  },
  // Safeguarding reports (#116): only a safeguarding lead reads them
  {
    table: "safeguarding_report",
    column: "description_ciphertext",
    purpose:
      "What the reporter saw or was told, so the safeguarding lead can act (encrypted)",
    retention: SAFEGUARDING_RECORD,
  },
  {
    table: "safeguarding_report",
    column: "subject_details_ciphertext",
    purpose:
      "Who the concern is about (a name, a school, a username), to find the child (encrypted)",
    retention: SAFEGUARDING_RECORD,
  },
  {
    table: "safeguarding_report",
    column: "subject_age",
    purpose:
      "The child's rough age, to judge urgency and how long to keep the report",
    retention: SAFEGUARDING_RECORD,
  },
  {
    table: "safeguarding_report",
    column: "reporter_name_ciphertext",
    purpose:
      "Who reported, when they chose not to stay anonymous, to follow up (encrypted)",
    retention: SAFEGUARDING_RECORD,
  },
  {
    table: "safeguarding_report",
    column: "reporter_contact_ciphertext",
    purpose:
      "How to reach the reporter (email or phone), when they chose to be reached (encrypted)",
    retention: SAFEGUARDING_RECORD,
  },
  {
    table: "safeguarding_report",
    column: "escalation_reference_ciphertext",
    purpose:
      "The outside authority's reference, to follow the case with them (encrypted)",
    retention: SAFEGUARDING_RECORD,
  },
  {
    table: "safeguarding_report",
    column: "outcome_ciphertext",
    purpose:
      "What the safeguarding lead decided and did, as the record of the case (encrypted)",
    retention: SAFEGUARDING_RECORD,
  },
  {
    table: "safeguarding_report",
    column: "assigned_to_user_id",
    purpose: "Records which safeguarding lead is handling the report",
    retention: SAFEGUARDING_RECORD,
  },
  {
    table: "safeguarding_incident_log",
    column: "body_ciphertext",
    purpose:
      "The lead's notes and decisions over the case's life, as its record (encrypted)",
    retention: SAFEGUARDING_RECORD,
  },
  {
    table: "safeguarding_incident_log",
    column: "author_user_id",
    purpose: "Records which safeguarding lead wrote each log entry",
    retention: SAFEGUARDING_RECORD,
  },
];
