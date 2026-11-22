// The guardians module (#81): a signed-in user declares they are a child's
// parent or lawful guardian and verifies by a one-time code; a verified
// guardian adds children (under 13: a profile they manage, with no login;
// 13 to 17: invited to an own login, linked to them). Its use cases join
// `as(actor)` through `guardiansUseCases`. 81b adds a minor's individual
// registration, held until the guardian has verified.

import type { UseCaseContext } from "../../use-cases";
import {
  myGuardianProfile,
  registerAsGuardian,
  type RegisterAsGuardianInput,
} from "./register-guardian";
import {
  confirmGuardianVerification,
  startGuardianVerification,
} from "./verify-guardian";

export type {
  MyGuardianProfile,
  RegisterAsGuardianInput,
  RegisterAsGuardianResult,
} from "./register-guardian";
export type {
  ConfirmGuardianVerificationResult,
  StartGuardianVerificationResult,
} from "./verify-guardian";

export const guardiansUseCases = (ctx: UseCaseContext) => ({
  registerAsGuardian: (input: RegisterAsGuardianInput) =>
    registerAsGuardian(ctx, input),
  myGuardianProfile: () => myGuardianProfile(ctx),
  startGuardianVerification: () => startGuardianVerification(ctx),
  confirmGuardianVerification: (input: { code: string }) =>
    confirmGuardianVerification(ctx, input),
});
