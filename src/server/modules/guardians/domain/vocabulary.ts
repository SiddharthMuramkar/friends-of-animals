// The guardians module's stored vocabularies (#81): the schema's enums are
// built from these lists. Plain TypeScript with no imports, so the schema
// file and the seed script can load it under plain Node.

/** How a guardian proved the contact a code went to: email now, phone later. */
export const GUARDIAN_VERIFICATION_METHODS = [
  "email_otp",
  "phone_otp",
] as const;

export type GuardianVerificationMethod =
  (typeof GUARDIAN_VERIFICATION_METHODS)[number];

/**
 * A guardian inviting a teen to an own login (#81), and a teen asking a
 * guardian to look after their profile (81b).
 */
export const GUARDIAN_INVITATION_KINDS = [
  "teen_login",
  "guardian_request",
] as const;

export type GuardianInvitationKind = (typeof GUARDIAN_INVITATION_KINDS)[number];

/** Stored statuses; "expired" is read from `expires_at` against the clock. */
export const GUARDIAN_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "revoked",
] as const;

export type StoredGuardianInvitationStatus =
  (typeof GUARDIAN_INVITATION_STATUSES)[number];

/** How an invitation reaches the invitee: email now, phone later. */
export const GUARDIAN_INVITATION_CHANNELS = ["email", "phone"] as const;

export type GuardianInvitationChannel =
  (typeof GUARDIAN_INVITATION_CHANNELS)[number];
