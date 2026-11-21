// What a school-route student's work may be used for (#83). An
// institution's declaration covers participation and judging only. Any
// public use (gallery, credit fields, social media, auction) needs a
// guardian's consent given by a code link, an accepted signed form, or the
// guardian's own account. Without it, the student counts for participation
// and judging and nothing else.
//
// Pure: callers load the subject's current consent for one purpose in one
// competition and pass it in. Loads under plain Node: relative imports only.

import type { GuardianPurpose } from "./guardian-purposes";

/**
 * The guardian purposes that make a minor's work or name public: all but
 * participation, which the declaration covers, and communications, which
 * isn't public.
 */
export const PUBLIC_PURPOSES = [
  "public_display",
  "display_school",
  "display_city",
  "social_media",
  "auction",
] as const satisfies readonly GuardianPurpose[];
export type PublicPurpose = (typeof PUBLIC_PURPOSES)[number];

/** Everything a school-route student's work can be used for. */
export type Use = "participation" | "judging" | PublicPurpose;

/** How consent was given, as #64's `consent_method` enum names it. */
export type ConsentMethod =
  | "web_form"
  | "otp_link"
  | "paper_form"
  | "staff_recorded";

/**
 * The subject's current consent to the purpose behind a use: participation
 * for participation and judging, the use itself otherwise.
 */
export type CurrentConsent =
  | { status: "never" }
  | { status: "given" | "withdrawn"; method: ConsentMethod };

export type UseBasis =
  | "institution_declaration"
  | "code_link"
  | "signed_form"
  | "web_form";

export type UseDecision =
  | { allowed: true; basis: UseBasis }
  | {
      allowed: false;
      reason:
        | "no_declaration"
        | "no_guardian_consent"
        | "withdrawn"
        | "method_not_accepted";
    };

/** A guardian's own act, so it counts for public use. */
const GUARDIAN_BASIS: Partial<Record<ConsentMethod, UseBasis>> = {
  otp_link: "code_link",
  paper_form: "signed_form",
  web_form: "web_form",
};

export function isPublicPurpose(purpose: string): purpose is PublicPurpose {
  return (PUBLIC_PURPOSES as readonly string[]).includes(purpose);
}

/** Whether a guardian's consent supports the use, and on what basis. */
function guardianConsent(consent: CurrentConsent): UseDecision {
  if (consent.status === "never") {
    return { allowed: false, reason: "no_guardian_consent" };
  }
  if (consent.status === "withdrawn") {
    return { allowed: false, reason: "withdrawn" };
  }
  const basis = GUARDIAN_BASIS[consent.method];
  return basis
    ? { allowed: true, basis }
    : { allowed: false, reason: "method_not_accepted" };
}

/**
 * Whether a school-route student's work may be used for `use`. A guardian
 * who withdrew participation overrides the declaration; a declaration never
 * stands in for a public use.
 */
export function decideSchoolRouteUse(input: {
  use: Use;
  /** The institution's participation and judging declaration exists. */
  institutionDeclared: boolean;
  consent: CurrentConsent;
}): UseDecision {
  const { use, institutionDeclared, consent } = input;
  if (isPublicPurpose(use)) return guardianConsent(consent);
  if (consent.status === "withdrawn") {
    return { allowed: false, reason: "withdrawn" };
  }
  if (institutionDeclared) {
    return { allowed: true, basis: "institution_declaration" };
  }
  const guardian = guardianConsent(consent);
  return guardian.allowed
    ? guardian
    : { allowed: false, reason: "no_declaration" };
}
