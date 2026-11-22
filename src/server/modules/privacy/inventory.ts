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

const AFTER_INVITATION_CLOSES = {
  period:
    "90 days after the invitation is accepted, withdrawn or expires (HR-31)",
  basis:
    "Lets the authorised person and FOA see who was invited, and answer a query about it",
  toConfirm: true,
} as const;

const WHILE_INVITATION_PENDING = {
  period: "Until the invitation is accepted, withdrawn or expires",
  basis:
    "Builds the link in the message when it is sent; cleared once the invitation is no longer waiting",
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

const WHILE_POST_EXISTS = {
  period: "While the post exists; deleted with it",
  basis:
    "A published post names its author, and FOA answers for who wrote and changed what it publishes",
  toConfirm: true,
} as const;

/** Payment records: an 8-year floor for financial records (HR-31). */
const PAYMENT_RECORD = {
  period: "8 years after the end of the financial year of the payment (HR-31)",
  basis:
    "Financial records: FOA answers for what was paid, by whom, and what it confirmed, to the payer, its auditors and the tax authorities",
  toConfirm: true,
} as const;

const WHILE_REGISTRATION_KEPT = {
  period:
    "While the institution takes part, then 3 years after the competition ends (HR-31)",
  basis:
    "Lets the institution and FOA see who registered it, and answer a query about the registration",
  toConfirm: true,
} as const;

const WHILE_STUDENT_TAKES_PART = {
  period:
    "Until 3 years after the last competition the participant (a school's student, or an adult on their own) was registered for (HR-31)",
  basis:
    "FOA, and the school for its students, run the competition with it, and answer queries about entries, results and certificates",
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
  // Coordinator invitations (#74)
  {
    table: "institution_invitation",
    column: "identifier_ciphertext",
    purpose:
      "The email or mobile number a coordinator invitation goes to (encrypted)",
    retention: AFTER_INVITATION_CLOSES,
  },
  {
    table: "institution_invitation",
    column: "identifier_hash",
    purpose:
      "Matches the invitee's account, and a second invitation to the same person, without storing the address readably",
    retention: AFTER_INVITATION_CLOSES,
  },
  {
    table: "institution_invitation",
    column: "token_ciphertext",
    purpose:
      "The invitation link's secret, so the message can carry it (encrypted)",
    retention: WHILE_INVITATION_PENDING,
  },
  {
    table: "institution_invitation",
    column: "invited_by_user_id",
    purpose: "Records which authorised person sent the invitation",
    retention: AFTER_INVITATION_CLOSES,
  },
  {
    table: "institution_invitation",
    column: "accepted_by_user_id",
    purpose: "Records which account accepted the invitation",
    retention: AFTER_INVITATION_CLOSES,
  },
  {
    table: "institution_invitation",
    column: "revoked_by_user_id",
    purpose: "Records which authorised person withdrew the invitation",
    retention: AFTER_INVITATION_CLOSES,
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
  // Blog posts and stories (#112)
  {
    table: "cms_post",
    column: "author_name",
    purpose: "The byline a post shows, as its editor typed it (optional)",
    retention: WHILE_POST_EXISTS,
  },
  {
    table: "cms_post",
    column: "created_by",
    purpose: "Records which content manager started the post",
    retention: WHILE_POST_EXISTS,
  },
  {
    table: "cms_post",
    column: "updated_by",
    purpose: "Records which content manager last changed the post",
    retention: WHILE_POST_EXISTS,
  },
  // Institution registrations for a competition (#75)
  {
    table: "institution_registration",
    column: "registered_by",
    purpose:
      "Records which coordinator or authorised person registered the institution for the competition",
    retention: WHILE_REGISTRATION_KEPT,
  },
  // Students an institution enrols (#75)
  {
    table: "participant_profile",
    column: "full_name",
    purpose:
      "Names the participant (a school's student, or an adult on their own) on lists, entries and certificates",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "dob_ciphertext",
    purpose:
      "Places the participant in an age group on the competition's cut-off date, and keeps an adult registering on their own from being a minor (encrypted)",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "grade",
    purpose: "Shows the student's class or year on the school's list",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "student_ref",
    purpose:
      "The school's own roll number, so the school recognises the student and FOA spots the same student entered twice",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "phone_ciphertext",
    purpose:
      "Reaches an adult student, or an adult registered on their own, about their entry (encrypted)",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "email_ciphertext",
    purpose: "Reaches an adult student about their entry (encrypted)",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "guardian_name_ciphertext",
    purpose: "Names a minor's parent or guardian to contact (encrypted)",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "guardian_relationship",
    purpose: "Says whether the contact is the minor's parent or legal guardian",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "guardian_phone_ciphertext",
    purpose: "Reaches a minor's parent or guardian about the entry (encrypted)",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "guardian_email_ciphertext",
    purpose: "Reaches a minor's parent or guardian about the entry (encrypted)",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "address_ciphertext",
    purpose:
      "Where certificates or artwork go back to, when it differs from the school (encrypted)",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "pin_code",
    purpose:
      "Locates the participant for regional rounds and reports (an adult abroad gives their postal code)",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "city",
    purpose: "Locates the participant for regional rounds and reports",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "state",
    purpose: "Locates the participant for regional rounds and reports",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "identity_hash",
    purpose:
      "A keyed hash of the name and date of birth that spots the same student entered twice, without reading either",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "created_by",
    purpose:
      "Records which coordinator or authorised person first entered the student",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  // Adults who register themselves (#78): their own profile
  {
    table: "participant_profile",
    column: "owner_user_id",
    purpose:
      "Links an adult's own profile to their account, so only they see and pay for their registrations",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "participant_code",
    purpose:
      "The FOA Participant ID that names an adult to FOA across competitions; never a way to sign in",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "country",
    purpose:
      "Where an adult on their own lives, so their postal code reads right and FOA reports by country",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "school_name",
    purpose:
      "The school or college an adult on their own names, if any, so FOA can invite it to take part",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  // Fee payments (#77). Webhook events keep no body: it carries the payer's
  // email and phone.
  {
    table: "payment_batch",
    column: "payer_user_id",
    purpose:
      "Records who paid an institution's fees, or an adult their own (#78), so the receipt reaches them and FOA can answer a query about the payment",
    retention: PAYMENT_RECORD,
  },
];
