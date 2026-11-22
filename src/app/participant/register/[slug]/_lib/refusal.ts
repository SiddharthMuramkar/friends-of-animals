// How the register form shows each refusal (#78): the message, as a key in
// the participant namespace, and the field it belongs to when the person
// can fix it there. The competition's own refusals show above the form.
//
// Pure: no imports beyond types.

import type { RegisterAsIndividualResult } from "@/server/modules/participants";

export type Refusal = Exclude<
  Extract<RegisterAsIndividualResult, { ok: false }>["error"],
  "invalid_input"
>;

export type RefusalView = {
  /** A key under `participant.`. */
  message: string;
  /** The field to mark, if the person can fix it there. */
  field?: "dateOfBirth" | "consents" | "guardianEmail";
};

const VIEWS: Record<Refusal, RefusalView> = {
  registration_closed: { message: "register.refusal.registration_closed" },
  institutions_only: { message: "register.refusal.institutions_only" },
  fee_not_set: { message: "register.refusal.fee_not_set" },
  dob_invalid: {
    message: "register.refusal.dob_invalid",
    field: "dateOfBirth",
  },
  // A profile's date of birth stays the one first given (#81).
  dob_mismatch: {
    message: "register.refusal.dob_mismatch",
    field: "dateOfBirth",
  },
  // A guardian registers a child under 13 (#81).
  under_13_needs_guardian: {
    message: "register.refusal.under_13_needs_guardian",
    field: "dateOfBirth",
  },
  adult_registers_self: { message: "register.refusal.adult_registers_self" },
  outside_age_groups: {
    message: "register.refusal.outside_age_groups",
    field: "dateOfBirth",
  },
  already_registered: { message: "register.refusal.already_registered" },
  consent_missing: {
    message: "register.refusal.consent_missing",
    field: "consents",
  },
  not_found: { message: "register.refusal.not_found" },
  // A teen on their own names a parent or guardian (#81).
  guardian_details_required: {
    message: "register.refusal.guardian_details_required",
  },
  guardian_contact_is_self: {
    message: "register.refusal.guardian_contact_is_self",
    field: "guardianEmail",
  },
  // A guardian's, staff, school or judge account never registers as a teen.
  requester_has_role: { message: "register.refusal.requester_has_role" },
  rate_limited: { message: "register.refusal.rate_limited" },
};

export function refusalView(refusal: Refusal): RefusalView {
  return VIEWS[refusal];
}

/** Every refusal the form may show, so the page words each one. */
export const REFUSALS = Object.keys(VIEWS) as readonly Refusal[];

/**
 * A refusal the page can show in place of the form, from what it already
 * knows about the competition, so nobody fills everything in only to hear
 * it takes schools only, or has no fee yet. Registering checks again.
 */
export function refusalBeforeForm(form: {
  acceptsIndividuals: boolean;
  fee: unknown;
}): Refusal | null {
  if (!form.acceptsIndividuals) return "institutions_only";
  if (form.fee === null) return "fee_not_set";
  return null;
}
