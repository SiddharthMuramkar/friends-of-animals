// The identity and access module: sign-up and sign-in by email or SMS
// code, and sessions. Its use cases join `as(actor)` through `identityUseCases`.

import type { UseCaseContext } from "../use-cases";
import { getAccount } from "./account";
import {
  listSessions,
  signOutEverywhere,
  signOutSession,
  type SignOutSessionInput,
} from "./sessions";
import {
  requestEmailCode,
  verifyEmailCode,
  type RequestEmailCodeInput,
  type VerifyEmailCodeInput,
} from "./email-code";
import {
  requestPhoneCode,
  verifyPhoneCode,
  type RequestPhoneCodeInput,
  type VerifyPhoneCodeInput,
} from "./phone-sign-in";

export type { Account } from "./account";
export type { SessionSummary, SignOutSessionResult } from "./sessions";
export type {
  RequestEmailCodeResult,
  VerifyEmailCodeResult,
} from "./email-code";
export type {
  RequestPhoneCodeResult,
  VerifyPhoneCodeResult,
} from "./phone-sign-in";
export { resolveActor } from "./session";
export { requestMeta } from "./request";

export const identityUseCases = (ctx: UseCaseContext) => ({
  requestEmailCode: (input: RequestEmailCodeInput) =>
    requestEmailCode(ctx, input),
  verifyEmailCode: (input: VerifyEmailCodeInput) => verifyEmailCode(ctx, input),
  requestPhoneCode: (input: RequestPhoneCodeInput) =>
    requestPhoneCode(ctx, input),
  verifyPhoneCode: (input: VerifyPhoneCodeInput) => verifyPhoneCode(ctx, input),
  // Not built yet: ./phone-limits.test.ts describes it.
  signInMethods: async (): Promise<never> => {
    throw new Error("not built yet");
  },
  getAccount: () => getAccount(ctx),
  listSessions: () => listSessions(ctx),
  signOutSession: (input: SignOutSessionInput) => signOutSession(ctx, input),
  signOutEverywhere: () => signOutEverywhere(ctx),
});
