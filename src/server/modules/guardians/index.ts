// The guardians module (#81): a signed-in user declares they are a child's
// parent or lawful guardian and verifies by a one-time code; a verified
// guardian adds children (under 13: a profile they manage, with no login;
// 13 to 17: invited to an own login, linked to them). Its use cases join
// `as(actor)` through `guardiansUseCases`. 81b adds a teen's request to a
// guardian they name, whose acceptance releases the teen's registrations
// held until a guardian has verified.

import type { UseCaseContext } from "../../use-cases";
import {
  addChild,
  getChild,
  listChildren,
  type AddChildInput,
} from "./children";
import {
  acceptGuardianRequest,
  viewGuardianRequest,
} from "./guardian-request";
import {
  acceptTeenInvitation,
  inviteTeenLogin,
  myGuardians,
  viewTeenInvitation,
  withdrawTeenInvitation,
  type InviteTeenLoginInput,
} from "./teen-login";
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
  ChildDetail,
  ChildLogin,
  ChildSummary,
  PendingTeenInvitation,
} from "./child-view";
export type { AddChildInput, AddChildResult, GetChildResult } from "./children";
export type {
  AcceptGuardianRequestResult,
  GuardianRequestView,
  ViewGuardianRequestResult,
} from "./guardian-request";
export type {
  MyGuardianProfile,
  RegisterAsGuardianInput,
  RegisterAsGuardianResult,
} from "./register-guardian";
export type {
  AcceptTeenInvitationResult,
  InviteTeenLoginInput,
  InviteTeenLoginResult,
  MyGuardian,
  TeenInvitationView,
  ViewTeenInvitationResult,
  WithdrawTeenInvitationResult,
} from "./teen-login";
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
  addChild: (input: AddChildInput) => addChild(ctx, input),
  listChildren: () => listChildren(ctx),
  getChild: (input: { childId: string }) => getChild(ctx, input),
  inviteTeenLogin: (input: InviteTeenLoginInput) => inviteTeenLogin(ctx, input),
  withdrawTeenInvitation: (input: { childId: string }) =>
    withdrawTeenInvitation(ctx, input),
  viewTeenInvitation: (input: { token: string }) =>
    viewTeenInvitation(ctx, input),
  acceptTeenInvitation: (input: { token: string }) =>
    acceptTeenInvitation(ctx, input),
  myGuardians: () => myGuardians(ctx),
  viewGuardianRequest: (input: { token: string }) =>
    viewGuardianRequest(ctx, input),
  acceptGuardianRequest: (input: { token: string; relationship: string }) =>
    acceptGuardianRequest(ctx, input),
});
