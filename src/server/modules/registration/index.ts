// The registration module (#75): an institution registers for a
// competition, its coordinators see which competitions they can register
// for, and they enrol students against the registration. Fees (#77) and
// the individual route (#78) join it. Its use cases join `as(actor)`
// through `registrationUseCases`.

import type { UseCaseContext } from "../../use-cases";
import { enrolStudent, type EnrolStudentInput } from "./enrol-student";
import { listEnrolledStudents } from "./list-enrolled-students";
import { withdrawStudent, type WithdrawStudentInput } from "./withdraw-student";
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
  EnrolmentRefusal,
  EnrolStudentInput,
  EnrolStudentResult,
} from "./enrol-student";
export type { StudentProblem } from "./domain/prepare-student";
export type { EnrolmentState } from "./domain/enrolment-state";
export type { RegistrationStatus } from "./domain/registration-status";
export type {
  EnrolledStudent,
  ListEnrolledStudentsResult,
} from "./list-enrolled-students";
export type {
  WithdrawStudentInput,
  WithdrawStudentResult,
} from "./withdraw-student";
export type { StudentField, StudentInput } from "./domain/student-details";
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
  enrolStudent: (input: EnrolStudentInput) => enrolStudent(ctx, input),
  listEnrolledStudents: (input: { institutionId: string; reference: string }) =>
    listEnrolledStudents(ctx, input),
  withdrawStudent: (input: WithdrawStudentInput) => withdrawStudent(ctx, input),
});
