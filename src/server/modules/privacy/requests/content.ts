// The privacy request columns the field cipher (#58) protects, and the
// purpose each is encrypted for. The purpose binds a value to its column,
// so correction details copied into the resolution column won't decrypt.
// Loads under plain Node: relative imports only.

import type { Ciphertext, FieldCipher } from "../../../crypto/field-cipher";

export const CONTENT_PURPOSES = {
  correctionDetails: "privacy_request.correction_details",
  rejectionReason: "privacy_request.rejection_reason",
  resolution: "privacy_request.resolution",
  noteBody: "privacy_request_note.body",
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

/** Reads back a value stored in `field`'s column, keeping null as null. */
export function openOrNull(
  cipher: FieldCipher,
  field: ContentField,
  stored: string | null
): string | null {
  return stored === null
    ? null
    : cipher.decrypt(CONTENT_PURPOSES[field], stored);
}

/** The longest texts people type here; each is stored encrypted. */
export const CORRECTION_DETAILS_MAX = 2000;
export const REJECTION_REASON_MAX = 1000;
export const RESOLUTION_MAX = 2000;
export const NOTE_MAX = 2000;
