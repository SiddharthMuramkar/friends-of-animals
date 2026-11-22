// The registration module (#75): an institution registers for a
// competition, and its coordinators see which competitions they can
// register for. Enrolling students (#75b), fees (#77) and the individual
// route (#78) join it. Its use cases join `as(actor)` through
// `registrationUseCases`.

import type { UseCaseContext } from "../../use-cases";
import { listCompetitionsForInstitution } from "./list-competitions-for-institution";
import {
  registerInstitutionForCompetition,
  type RegisterInstitutionForCompetitionInput,
} from "./register-institution";

export type {
  CompetitionForInstitution,
  CompetitionWindow,
  ListCompetitionsForInstitutionResult,
} from "./list-competitions-for-institution";
export type {
  RegisterInstitutionForCompetitionInput,
  RegisterInstitutionForCompetitionResult,
} from "./register-institution";

export const registrationUseCases = (ctx: UseCaseContext) => ({
  registerInstitutionForCompetition: (
    input: RegisterInstitutionForCompetitionInput
  ) => registerInstitutionForCompetition(ctx, input),
  listCompetitionsForInstitution: (input: { institutionId: string }) =>
    listCompetitionsForInstitution(ctx, input),
});
