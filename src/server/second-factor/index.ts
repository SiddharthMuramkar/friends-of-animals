// The second-factor module (#60): staff two-factor authentication and
// step-up. Its use cases join `as(actor)` through `secondFactorUseCases`.

import type { UseCaseContext } from "../use-cases";
import {
  confirmTotpEnrolment,
  mySecondFactors,
  startTotpEnrolment,
  verifySecondFactor,
} from "./totp";

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
});
