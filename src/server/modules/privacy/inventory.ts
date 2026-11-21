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
];
