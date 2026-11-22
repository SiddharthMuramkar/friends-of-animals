// How the register form shows each refusal (#78): the message, as a key in
// the participant namespace, and the field it belongs to when the person
// can fix it there. The competition's own refusals show above the form.
//
// Pure: no imports beyond types.

import type { IndividualRegistrationRefusal } from "@/server/modules/participants";

export type Refusal = IndividualRegistrationRefusal | "not_found";

export type RefusalView = {
  /** A key under `participant.`. */
  message: string;
  /** The field to mark, if the person can fix it there. */
  field?: "dateOfBirth" | "consents";
};

const VIEWS: Record<Refusal, RefusalView> = {
  registration_closed: { message: "register.refusal.registration_closed" },
  institutions_only: { message: "register.refusal.institutions_only" },
  fee_not_set: { message: "register.refusal.fee_not_set" },
  dob_invalid: {
    message: "register.refusal.dob_invalid",
    field: "dateOfBirth",
  },
  // The come-back pointer, until the guardian route opens (#81).
  minor: { message: "register.minor", field: "dateOfBirth" },
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
};

export function refusalView(refusal: Refusal): RefusalView {
  return VIEWS[refusal];
}
