// The coordinators part of the Institutions module (#74): the authorised
// person invites teachers to coordinate, an invitee accepts, and the
// authorised person lists and removes coordinators. Its use cases join
// `as(actor)` through `coordinatorsUseCases`.

import type { UseCaseContext } from "../../../use-cases";
import { acceptInvitation, viewInvitation } from "./accept-invitation";
import {
  listCoordinators,
  removeCoordinator,
  revokeInvitation,
} from "./manage-coordinators";
import {
  inviteCoordinator,
  type InviteCoordinatorInput,
} from "./invite-coordinator";

export type {
  AcceptInvitationResult,
  InvitationView,
  ViewInvitationResult,
} from "./accept-invitation";
export type {
  Coordinator,
  ListCoordinatorsResult,
  RemoveCoordinatorResult,
  RevokeInvitationResult,
  WaitingInvitation,
} from "./manage-coordinators";
export type {
  InviteCoordinatorInput,
  InviteCoordinatorResult,
} from "./invite-coordinator";

export const coordinatorsUseCases = (ctx: UseCaseContext) => ({
  inviteCoordinator: (input: InviteCoordinatorInput) =>
    inviteCoordinator(ctx, input),
  viewInvitation: (input: { token: string }) => viewInvitation(ctx, input),
  acceptInvitation: (input: { token: string }) => acceptInvitation(ctx, input),
  listCoordinators: (input: { institutionId: string }) =>
    listCoordinators(ctx, input),
  removeCoordinator: (input: { institutionId: string; userId: string }) =>
    removeCoordinator(ctx, input),
  revokeInvitation: (input: { institutionId: string; invitationId: string }) =>
    revokeInvitation(ctx, input),
});
