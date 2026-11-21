// The second-factor module (#60): staff two-factor authentication and
// step-up. Its use cases join `as(actor)` through `secondFactorUseCases`.

import type { UseCaseContext } from "../../use-cases";
import { removeSecondFactor, resetSecondFactors } from "./manage";
import {
  finishPasskeyRegistration,
  finishPasskeyVerification,
  startPasskeyRegistration,
  startPasskeyVerification,
} from "./passkeys";
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
export type {
  FinishPasskeyRegistrationResult,
  FinishPasskeyVerificationResult,
  StartPasskeyRegistrationResult,
  StartPasskeyVerificationResult,
} from "./passkeys";
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
  startPasskeyRegistration: () => startPasskeyRegistration(ctx),
  finishPasskeyRegistration: (
    input: Parameters<typeof finishPasskeyRegistration>[1]
  ) => finishPasskeyRegistration(ctx, input),
  startPasskeyVerification: () => startPasskeyVerification(ctx),
  finishPasskeyVerification: (
    input: Parameters<typeof finishPasskeyVerification>[1]
  ) => finishPasskeyVerification(ctx, input),
});
