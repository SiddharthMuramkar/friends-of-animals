// How an invitation shows who it was sent to (#74). Anyone holding the link
// sees this on the accept page, so it says enough for the right person to
// recognise their address and pick the account to sign in with, and no more.
//
// Pure. Loads under plain Node: relative imports only, no "server-only".

/** How an invitation reaches the invitee. */
export type InviteeChannel = "email" | "phone";

const HIDDEN = "***";

/**
 * A normalised email (`a***@school.test`) or E.164 phone number (`***3210`)
 * with most of it hidden. Anything malformed is hidden entirely.
 */
export function maskIdentifier(
  channel: InviteeChannel,
  normalised: string
): string {
  if (channel === "email") {
    const at = normalised.lastIndexOf("@");
    if (at <= 0 || at === normalised.length - 1) return HIDDEN;
    return `${normalised[0]}${HIDDEN}${normalised.slice(at)}`;
  }
  const digits = normalised.replace(/\D/g, "");
  if (digits.length <= 4) return HIDDEN;
  return `${HIDDEN}${digits.slice(-4)}`;
}
