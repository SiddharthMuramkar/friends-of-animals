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

const WHILE_REGISTRATION_KEPT = {
  period:
    "While the institution takes part, then 3 years after the competition ends (HR-31)",
  basis:
    "Lets the institution and FOA see who registered it, and answer a query about the registration",
  toConfirm: true,
} as const;

const WHILE_STUDENT_TAKES_PART = {
  period:
    "Until 3 years after the last competition the student was enrolled in (HR-31)",
  basis:
    "FOA and the school run the competition with it, and answer queries about entries, results and certificates",
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
    purpose: "Names the student on the school's list, entries and certificates",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "dob_ciphertext",
    purpose:
      "Places the student in an age group on the competition's cut-off date (encrypted)",
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
    purpose: "Reaches an adult student about their entry (encrypted)",
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
    purpose: "Locates the student for regional rounds and reports",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "city",
    purpose: "Locates the student for regional rounds and reports",
    retention: WHILE_STUDENT_TAKES_PART,
  },
  {
    table: "participant_profile",
    column: "state",
    purpose: "Locates the student for regional rounds and reports",
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
];
