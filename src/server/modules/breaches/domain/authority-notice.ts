// How the authority hears of a breach (#116). FOA's counsel names the
// channel (the Data Protection Board's, or CERT-In's for a cyber incident;
// residue HR-49). Until then, the setting `breach.authorityEmail` may hold
// an address: when valid, the notice is emailed there through the email port.
// Without a usable address, staff file by hand and record the reference
// the authority gave them. With neither, nothing can be recorded.
//
// Pure, and loads under plain Node.

import { z } from "zod";

export const AUTHORITY_REFERENCE_MAX = 200;

const emailAddress = z.email();

export function configuredAuthorityEmail(
  setting: string | null
): string | null {
  const address = setting?.trim();
  const parsed = emailAddress.safeParse(address);
  return parsed.success ? parsed.data : null;
}

export type AuthorityNotice =
  | { kind: "email"; to: string }
  | { kind: "manual"; reference: string }
  | {
      kind: "refused";
      reason: "authority_unconfigured" | "authority_email_invalid";
    };

/** Decides how this notice to the authority goes out. */
export function planAuthorityNotice(input: {
  /** The `breach.authorityEmail` setting; blank means unset. */
  authorityEmail: string | null;
  /** The reference staff got when filing by hand. */
  manualReference?: string | undefined;
}): AuthorityNotice {
  const to = configuredAuthorityEmail(input.authorityEmail);
  if (to) return { kind: "email", to };
  const reference = input.manualReference
    ?.trim()
    .slice(0, AUTHORITY_REFERENCE_MAX);
  if (reference) return { kind: "manual", reference };
  return {
    kind: "refused",
    reason: input.authorityEmail?.trim()
      ? "authority_email_invalid"
      : "authority_unconfigured",
  };
}
