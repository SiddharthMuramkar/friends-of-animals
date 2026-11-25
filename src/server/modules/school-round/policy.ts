// Who may run the school round's use cases (#89): their rules in the
// platform policy (src/server/access/policies.ts). Running the round is the
// institution's own business: its coordinators and its authorised person,
// at that institution's scope, as `institution.coordinate`. FOA staff don't
// pick a school's shortlist. The outcomes (shortlisted or not, and the
// school position) are read by the platform itself, by a competition
// manager of that competition (or a global one), and by the institution.
//
// Loads under plain Node: relative imports only, no "server-only".

import { anyOf, role, system, type Policy } from "../../access/domain/policy";
import { COORDINATORS_POLICY } from "../institutions/coordinators/policy";

const institutionPeople = COORDINATORS_POLICY["institution.coordinate"];

export const SCHOOL_ROUND_POLICY = {
  "school_round.read": institutionPeople,
  "school_round.manage": institutionPeople,
  "school_round.finalise": institutionPeople,
  "school_round.outcomes.read": anyOf(
    system("worker", "cli", "seed"),
    role("competition_manager"),
    institutionPeople
  ),
} satisfies Policy<string>;
