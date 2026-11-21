// May this person register themselves for this competition? The one place
// that answers it for the individual route, so the register use case, its
// form and the guardian route that follows (which changes only what a
// `minor` refusal leads to) give the same answer for the same facts.
//
// Pure: the use case loads the facts and passes the clock's instant.

import { type CalendarDate, isAdultAt, parseDateOfBirth } from "./age";

export type IndividualRegistrationRequest = {
  competition: {
    /** The competition's status is registration_open at `at`. */
    registrationOpen: boolean;
    /** The competition takes individual entries as well as schools. */
    acceptsIndividuals: boolean;
  };
  /** As typed: `YYYY-MM-DD`. */
  dateOfBirth: string;
  /** This person already has a registration for this competition. */
  alreadyRegistered: boolean;
  /** Document versions, by id: the competition's required ones, and the ones ticked. */
  consents: { required: readonly string[]; given: readonly string[] };
  /** The registration instant, from the injected clock. */
  at: Date;
};

/**
 * Why a registration is refused, in the order they are checked: first the
 * competition's own reasons (nothing the person can change), then who the
 * person is, then what they can fix on the form.
 */
export type IndividualRegistrationRefusal =
  | "registration_closed"
  | "institutions_only"
  | "dob_invalid"
  | "minor"
  | "already_registered"
  | "consent_missing";

export type IndividualRegistrationDecision =
  | { ok: true; dateOfBirth: CalendarDate }
  | { ok: false; reason: IndividualRegistrationRefusal };

/**
 * Decides an individual registration. Age is counted on India's calendar at
 * the registration instant; under 18 is refused until the guardian route
 * exists. On success returns the parsed date of birth to store.
 */
export function decideIndividualRegistration(
  request: IndividualRegistrationRequest
): IndividualRegistrationDecision {
  const refuse = (reason: IndividualRegistrationRefusal) =>
    ({ ok: false, reason }) as const;

  if (!request.competition.registrationOpen) {
    return refuse("registration_closed");
  }
  if (!request.competition.acceptsIndividuals) {
    return refuse("institutions_only");
  }
  const dateOfBirth = parseDateOfBirth(request.dateOfBirth, request.at);
  if (!dateOfBirth) return refuse("dob_invalid");
  if (!isAdultAt(dateOfBirth, request.at)) return refuse("minor");
  if (request.alreadyRegistered) return refuse("already_registered");
  const given = new Set(request.consents.given);
  if (!request.consents.required.every((id) => given.has(id))) {
    return refuse("consent_missing");
  }
  return { ok: true, dateOfBirth };
}
