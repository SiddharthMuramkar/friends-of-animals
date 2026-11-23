// May this person be registered for this competition on the individual
// route, and how does the registration start? The one place that answers
// it, so the register use case and its form give the same answer for the
// same facts. An adult registers themselves (#78); a minor takes part with
// a guardian (#81): a verified guardian registers their child, a teen of
// 13 to 17 may register themselves, and a minor's registration is held
// until a guardian has verified (./minor-registration.ts) and given
// participation consent (#82).
//
// A date of birth, once a profile holds it, is the one every later
// registration counts: a different one typed is refused, never stored, so
// nobody's age (and with it the guardian rules) changes by retyping it.
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
  compareDates,
  parseIsoDate,
  type CalendarDate,
} from "../../registration/domain/calendar-date";
import { ADULT_AGE, ageAt, parseDateOfBirth } from "./age";
import {
  decideMinorRegistration,
  type MinorRegistrant,
  type MinorRegistrationRefusal,
} from "./minor-registration";

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
  /** As typed, or as the child's profile keeps it: `YYYY-MM-DD`. */
  dateOfBirth: string;
  /**
   * The date of birth the person's profile already holds (`YYYY-MM-DD`),
   * or null before their first registration. A typed one must match it.
   */
  storedDateOfBirth: string | null;
  /**
   * Who registers: the person themselves (with their guardian's state, if
   * they turn out to be a minor), or a guardian for their own child.
   */
  registrant: MinorRegistrant;
  /** This person already has a registration for this competition. */
  alreadyRegistered: boolean;
  /** Document versions, by id: the competition's required ones, and the ones ticked. */
  consents: { required: readonly string[]; given: readonly string[] };
  /**
   * A minor's guardian has given participation on the competition's
   * attached version (#82), already or on this form. Without it a minor's
   * registration is held, even once their guardian has verified.
   */
  participationGiven: boolean;
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
  | "dob_mismatch"
  | Exclude<MinorRegistrationRefusal, "not_a_minor">
  | "outside_age_groups"
  | "already_registered"
  | "consent_missing";

export type IndividualRegistrationDecision =
  | {
      ok: true;
      dateOfBirth: CalendarDate;
      ageGroup: AgeGroup;
      /** Waiting for its fee, or held until a guardian has verified. */
      status: "pending_payment" | "pending_guardian";
      /** A teen with no guardian yet: a guardian they name must be asked. */
      askGuardian: boolean;
    }
  | { ok: false; reason: IndividualRegistrationRefusal };

/**
 * Decides an individual registration. Under 18 on India's calendar at the
 * registration instant takes the guardian rules. On success returns the
 * parsed date of birth to store, the age group and the starting status.
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
  if (request.storedDateOfBirth !== null) {
    const stored = parseIsoDate(request.storedDateOfBirth);
    if (!stored) throw new Error("A stored date of birth is not a date");
    if (compareDates(dateOfBirth, stored) !== 0) return refuse("dob_mismatch");
  }
  const ageYears = ageAt(dateOfBirth, request.at);
  const adult = ageYears >= ADULT_AGE && request.registrant.kind === "self";
  const start = adult
    ? ({ ok: true, status: "pending_payment", askGuardian: false } as const)
    : decideMinorRegistration({ ageYears, registrant: request.registrant });
  if (!start.ok) {
    if (start.reason === "not_a_minor") throw new Error("unreachable");
    return refuse(start.reason);
  }
  // A minor's waits for payment only with participation consent too.
  const status =
    !adult && start.status === "pending_payment" && !request.participationGiven
      ? "pending_guardian"
      : start.status;
  const cutoff = parseIsoDate(competition.ageCutoffDate);
  if (!cutoff) throw new Error("A competition's age cut-off is not a date");
  const placed = ageGroupFor(dateOfBirth, cutoff, competition.ageGroups);
  if (!placed.ok) return refuse("outside_age_groups");
  if (request.alreadyRegistered) return refuse("already_registered");
  const given = new Set(request.consents.given);
  if (!request.consents.required.every((id) => given.has(id))) {
    return refuse("consent_missing");
  }
  return {
    ok: true,
    dateOfBirth,
    ageGroup: placed.group,
    status,
    askGuardian: start.askGuardian,
  };
}
