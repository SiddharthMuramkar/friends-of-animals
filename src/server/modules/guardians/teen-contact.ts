// Who a teen-login invitation is for (#81): an email address now (a phone
// once its SMS template is registered, HR-14), and how its encrypted
// fields are named for the field cipher and the blind index.
//
// Loads under plain Node (the worker, the seed script): relative imports
// only, no "server-only".

import { z } from "zod";

import type { BlindIndex } from "../../crypto/blind-index";
import type { Ciphertext, FieldCipher } from "../../crypto/field-cipher";
import { normaliseEmailAddress } from "../../ports/email";
import type { GuardianInvitationChannel } from "./domain/vocabulary";

/** The purpose the cipher and blind index bind an invited address to. */
export const TEEN_CONTACT = "guardian_invitation.contact";

/** The purpose the cipher binds a link token's stored copy to. */
export const TEEN_INVITATION_TOKEN = "guardian_invitation.token";

export type TeenContact = {
  channel: GuardianInvitationChannel;
  address: string;
};

const email = z.email().max(254);

/** An email address, normalised; null for anything else. */
export function parseTeenEmail(typed: string): TeenContact | null {
  const address = normaliseEmailAddress(typed.trim());
  return email.safeParse(address).success
    ? { channel: "email", address }
    : null;
}

/** The blind index an invitation's address is matched by. */
export function teenContactHash(
  { blindIndex }: { blindIndex: BlindIndex },
  address: string
): string {
  return blindIndex.of(TEEN_CONTACT, address);
}

/** The columns that store who an invitation is for. */
export function storedTeenContact(
  deps: { cipher: FieldCipher; blindIndex: BlindIndex },
  contact: TeenContact
): {
  channel: GuardianInvitationChannel;
  contactCiphertext: Ciphertext;
  contactHash: string;
} {
  return {
    channel: contact.channel,
    contactCiphertext: deps.cipher.encrypt(TEEN_CONTACT, contact.address),
    contactHash: teenContactHash(deps, contact.address),
  };
}

/** Who a stored invitation is for, read back. */
export function readTeenContact(
  { cipher }: { cipher: FieldCipher },
  row: { channel: GuardianInvitationChannel; contactCiphertext: string }
): TeenContact {
  return {
    channel: row.channel,
    address: cipher.decrypt(TEEN_CONTACT, row.contactCiphertext),
  };
}
