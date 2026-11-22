// May this person register themselves for this competition? The one place
// that answers it for the individual route, so the register use case, its
// form and the guardian route that follows (which changes only what a
// `minor` refusal leads to) give the same answer for the same facts.
//
// Two different dates count. Whether someone is an adult is their age on
// India's calendar at the registration instant; which age group they enter
// is their age on the competition's cut-off date (#75), as for a school's
// student.
//
// Pure: the use case loads the facts and passes the clock's instant.

import {
  ageGroupFor,
  type AgeGroup,
} from "../../registration/domain/age-group";
import {
  parseIsoDate,
  type CalendarDate,
} from "../../registration/domain/calendar-date";
import { isAdultAt, parseDateOfBirth } from "./age";

export type IndividualRegistrationRequest = {
  competition: {
    /** The competition's status is registration_open at `at`. */
    registrationOpen: boolean;
    /** The competition takes individual entries as well as schools. */
    acceptsIndividuals: boolean;
    /** FOA has set the individual fee (zero for a free competition). */
    feeSet: boolean;
    /** `YYYY-MM-DD`: the day ages are counted on for the age groups. */
    ageCutoffDate: string;
    /** In the order its manager listed them. */
    ageGroups: readonly AgeGroup[];
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
  | "fee_not_set"
  | "dob_invalid"
  | "minor"
  | "outside_age_groups"
  | "already_registered"
  | "consent_missing";

export type IndividualRegistrationDecision =
  | { ok: true; dateOfBirth: CalendarDate; ageGroup: AgeGroup }
  | { ok: false; reason: IndividualRegistrationRefusal };

/**
 * Decides an individual registration. Under 18 on India's calendar at the
 * registration instant is refused until the guardian route exists. On
 * success returns the parsed date of birth to store and the age group.
 */
export function decideIndividualRegistration(
  request: IndividualRegistrationRequest
): IndividualRegistrationDecision {
  const refuse = (reason: IndividualRegistrationRefusal) =>
    ({ ok: false, reason }) as const;
  const { competition } = request;

  if (!competition.registrationOpen) return refuse("registration_closed");
  if (!competition.acceptsIndividuals) return refuse("institutions_only");
  if (!competition.feeSet) return refuse("fee_not_set");
  const dateOfBirth = parseDateOfBirth(request.dateOfBirth, request.at);
  if (!dateOfBirth) return refuse("dob_invalid");
  if (!isAdultAt(dateOfBirth, request.at)) return refuse("minor");
  const cutoff = parseIsoDate(competition.ageCutoffDate);
  if (!cutoff) throw new Error("A competition's age cut-off is not a date");
  const placed = ageGroupFor(dateOfBirth, cutoff, competition.ageGroups);
  if (!placed.ok) return refuse("outside_age_groups");
  if (request.alreadyRegistered) return refuse("already_registered");
  const given = new Set(request.consents.given);
  if (!request.consents.required.every((id) => given.has(id))) {
    return refuse("consent_missing");
  }
  return { ok: true, dateOfBirth, ageGroup: placed.group };
}
