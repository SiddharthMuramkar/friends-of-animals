// The breach log's columns the field cipher (#58) protects, and the purpose
// each is encrypted for. The purpose binds a value to its column, so an
// impact copied into a note won't decrypt. Loads under plain Node (the seed
// script): relative imports only.

import type { Ciphertext, FieldCipher } from "../../crypto/field-cipher";

export const BREACH_CONTENT_PURPOSES = {
  title: "breach_record.title",
  impact: "breach_record.impact",
  authorityReference: "breach_record.authority_reference",
  note: "breach_timeline_event.note",
} as const;

export type BreachContentField = keyof typeof BREACH_CONTENT_PURPOSES;

/** Encrypts `text` for `field`'s column. */
export function sealBreachText(
  cipher: FieldCipher,
  field: BreachContentField,
  text: string
): Ciphertext {
  return cipher.encrypt(BREACH_CONTENT_PURPOSES[field], text);
}

/** Reads back a value stored in `field`'s column, keeping null as null. */
export function openBreachText(
  cipher: FieldCipher,
  field: BreachContentField,
  stored: string
): string;
export function openBreachText(
  cipher: FieldCipher,
  field: BreachContentField,
  stored: string | null
): string | null;
export function openBreachText(
  cipher: FieldCipher,
  field: BreachContentField,
  stored: string | null
): string | null {
  return stored === null
    ? null
    : cipher.decrypt(BREACH_CONTENT_PURPOSES[field], stored);
}
