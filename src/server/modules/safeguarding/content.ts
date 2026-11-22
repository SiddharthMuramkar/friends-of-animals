// The safeguarding columns the field cipher (#58) protects, and the
// purpose each is encrypted for. The purpose binds a value to its column,
// so a description copied into the outcome column won't decrypt. Loads
// under plain Node (the seed script): relative imports only.

import type { Ciphertext, FieldCipher } from "../../crypto/field-cipher";

export const CONTENT_PURPOSES = {
  description: "safeguarding_report.description",
  subjectDetails: "safeguarding_report.subject_details",
  reporterName: "safeguarding_report.reporter_name",
  reporterContact: "safeguarding_report.reporter_contact",
  escalationReference: "safeguarding_report.escalation_reference",
  outcome: "safeguarding_report.outcome",
  logBody: "safeguarding_incident_log.body",
} as const;

export type ContentField = keyof typeof CONTENT_PURPOSES;

/** Encrypts `text` for `field`'s column. */
export function seal(
  cipher: FieldCipher,
  field: ContentField,
  text: string
): Ciphertext {
  return cipher.encrypt(CONTENT_PURPOSES[field], text);
}

/** Encrypts `text` for `field`'s column, keeping null as null. */
export function sealOrNull(
  cipher: FieldCipher,
  field: ContentField,
  text: string | null
): Ciphertext | null {
  return text === null ? null : seal(cipher, field, text);
}

/** Reads back a value stored in `field`'s column. */
export function open(
  cipher: FieldCipher,
  field: ContentField,
  stored: string
): string {
  return cipher.decrypt(CONTENT_PURPOSES[field], stored);
}

/** Reads back a value stored in `field`'s column, keeping null as null. */
export function openOrNull(
  cipher: FieldCipher,
  field: ContentField,
  stored: string | null
): string | null {
  return stored === null ? null : open(cipher, field, stored);
}
