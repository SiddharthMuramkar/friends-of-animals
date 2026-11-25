// Who may run the institution-submissions use cases (#87): their rules in
// the platform policy (src/server/access/policies.ts). Everything here is
// the institution's own business: its coordinators and its authorised
// person, at that institution's scope, as `institution.coordinate`. Not FOA
// staff: they see entries through their own pages.
//
// Loads under plain Node: relative imports only, no "server-only".

import type { Policy } from "../../access/domain/policy";
import { COORDINATORS_POLICY } from "../institutions/coordinators/policy";

const institutionPeople = COORDINATORS_POLICY["institution.coordinate"];

export const INSTITUTION_SUBMISSIONS_POLICY = {
  "institution_submissions.read": institutionPeople,
  "conduct.read": institutionPeople,
  "conduct.certify": institutionPeople,
} satisfies Policy<string>;
