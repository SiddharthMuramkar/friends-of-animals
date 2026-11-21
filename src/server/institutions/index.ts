// The institutions module (#73): registration by an institution's
// authorised person, and FOA staff's verification, which gives the
// Institution ID. Its use cases join `as(actor)` through
// `institutionUseCases`.

import type { UseCaseContext } from "../use-cases";
import type { RegisterInstitutionInput } from "./domain/registration";
import { getMyInstitution } from "./queries";
import { registerInstitution } from "./register";

export type { InstitutionDetails, GetMyInstitutionResult } from "./queries";
export type { RegisterInstitutionResult } from "./register";
export type {
  InstitutionType,
  RegisterInstitutionInput,
} from "./domain/registration";
export {
  INSTITUTION_TYPES,
  MAX_EXPECTED_PARTICIPANTS,
} from "./domain/registration";
export type {
  InstitutionDecision,
  InstitutionOutcome,
  InstitutionStatus,
} from "./domain/status";
export {
  DECISION_REASON_MAX_LENGTH,
  INSTITUTION_DECISIONS,
  INSTITUTION_STATUSES,
} from "./domain/status";

export const institutionUseCases = (ctx: UseCaseContext) => ({
  registerInstitution: (input: RegisterInstitutionInput) =>
    registerInstitution(ctx, input),
  getMyInstitution: () => getMyInstitution(ctx),
});
