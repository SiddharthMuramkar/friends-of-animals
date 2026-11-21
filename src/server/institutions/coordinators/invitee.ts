// Who an invitation is for (#74): an email address or an Indian mobile
// number, as the authorised person types it into one field, read into the
// one form it is stored, matched and sent by. Also how an invitation's
// encrypted fields are named for the field cipher and the blind index.
//
// Loads under plain Node (the worker, the seed script): relative imports
// only, no "server-only".

import { z } from "zod";

import { parsePhoneNumber, type E164Phone } from "../../../lib/phone";
import type { BlindIndex } from "../../crypto/blind-index";
import type { Ciphertext, FieldCipher } from "../../crypto/field-cipher";
import { normaliseEmailAddress } from "../../ports/email";
import type { InviteeChannel } from "../domain/mask-identifier";

/** The purpose the cipher and blind index bind an invitee's address to. */
export const INVITATION_IDENTIFIER = "institution_invitation.identifier";

/** The purpose the cipher binds a link token's stored copy to. */
export const INVITATION_TOKEN = "institution_invitation.token";

export type Invitee =
  | { channel: "email"; address: string }
  | { channel: "phone"; address: E164Phone };

const email = z.email().max(254);

/**
 * An email (anything with an "@") or an Indian mobile number, normalised;
 * null for anything else.
 */
export function parseInvitee(typed: string): Invitee | null {
  const trimmed = typed.trim();
  if (trimmed.includes("@")) {
    const address = normaliseEmailAddress(trimmed);
    return email.safeParse(address).success
      ? { channel: "email", address }
      : null;
  }
  const phone = parsePhoneNumber(trimmed);
  return phone.ok ? { channel: "phone", address: phone.e164 } : null;
}

/** The blind index an invitation is matched by. */
export function inviteeHash(
  { blindIndex }: { blindIndex: BlindIndex },
  address: string
): string {
  return blindIndex.of(INVITATION_IDENTIFIER, address);
}

/** The columns that store who an invitation is for. */
export function storedInvitee(
  deps: { cipher: FieldCipher; blindIndex: BlindIndex },
  invitee: Invitee
): {
  channel: InviteeChannel;
  identifierCiphertext: Ciphertext;
  identifierHash: string;
} {
  return {
    channel: invitee.channel,
    identifierCiphertext: deps.cipher.encrypt(
      INVITATION_IDENTIFIER,
      invitee.address
    ),
    identifierHash: inviteeHash(deps, invitee.address),
  };
}

/** Who a stored invitation is for, read back. */
export function readInvitee(
  { cipher }: { cipher: FieldCipher },
  row: { channel: InviteeChannel; identifierCiphertext: string }
): Invitee {
  const address = cipher.decrypt(
    INVITATION_IDENTIFIER,
    row.identifierCiphertext
  );
  return row.channel === "email"
    ? { channel: "email", address }
    : { channel: "phone", address: address as E164Phone };
}
