// The second-factor module (#60): staff two-factor authentication and
// step-up. Its use cases join `as(actor)` through `secondFactorUseCases`.

import type { UseCaseContext } from "../../use-cases";
import { removeSecondFactor, resetSecondFactors } from "./manage";
import { staffAccess } from "./staff-access";
import {
  confirmTotpEnrolment,
  mySecondFactors,
  startTotpEnrolment,
  verifySecondFactor,
} from "./totp";

export type {
  RemoveSecondFactorResult,
  ResetSecondFactorsResult,
} from "./manage";
export type { StaffAccess } from "./staff-access";
export type {
  ConfirmTotpEnrolmentResult,
  FactorSummary,
  MySecondFactors,
  StartTotpEnrolmentResult,
  VerifySecondFactorResult,
} from "./totp";

export const secondFactorUseCases = (ctx: UseCaseContext) => ({
  startTotpEnrolment: (input: { label: string }) =>
    startTotpEnrolment(ctx, input),
  confirmTotpEnrolment: (input: { factorId: string; code: string }) =>
    confirmTotpEnrolment(ctx, input),
  verifySecondFactor: (input: { code: string }) =>
    verifySecondFactor(ctx, input),
  mySecondFactors: () => mySecondFactors(ctx),
  staffAccess: () => staffAccess(ctx),
  removeSecondFactor: (input: { factorId: string }) =>
    removeSecondFactor(ctx, input),
  resetSecondFactors: (input: { userId: string }) =>
    resetSecondFactors(ctx, input),
});
