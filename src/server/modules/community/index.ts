import type { UseCaseContext } from "../../use-cases";
import {
  getMyCommunity,
  joinCommunity,
  leaveCommunity,
  updateMemberProfile,
  type MemberProfileInput,
  type TargetInput,
} from "./membership";
import { listMembers, type ListMembersInput } from "./members";
import { rebuildMilestones, recordPublishedEngagement } from "./results";
import type { EventOf } from "../../outbox/events";
import { getMyAmbassador, applyForAmbassador, listAmbassadorApplications, decideAmbassador, type AmbassadorListInput, type AmbassadorDecisionInput } from "./ambassadors/applications";
import { getTimeline } from "./timeline";
export { recordEngagement, type EngagementFact } from "./engagement";
export { communityMemberFor, personKeys, childKeys } from "./subjects";
export type { Subject } from "./domain/subject";
export type { MilestoneKind } from "./domain/milestones";

export const communityUseCases = (ctx: UseCaseContext) => ({
  getMyAmbassador: () => getMyAmbassador(ctx),
  applyForAmbassador: () => applyForAmbassador(ctx),
  listAmbassadorApplications: (input: AmbassadorListInput = {}) => listAmbassadorApplications(ctx, input),
  decideAmbassador: (input: AmbassadorDecisionInput) => decideAmbassador(ctx, input),
  joinCommunity: (input: MemberProfileInput) => joinCommunity(ctx, input),
  updateMemberProfile: (input: MemberProfileInput) =>
    updateMemberProfile(ctx, input),
  leaveCommunity: (input: TargetInput = {}) => leaveCommunity(ctx, input),
  getMyCommunity: (input: TargetInput = {}) => getMyCommunity(ctx, input),
  listMembers: (input: ListMembersInput = {}) => listMembers(ctx, input),
  rebuildMilestones: (input: { competitionId: string }) =>
    rebuildMilestones(ctx, input),
  recordPublishedEngagement: (input: EventOf<"results.published">["payload"]) =>
    recordPublishedEngagement(ctx, input),
  getTimeline: (input: TargetInput = {}) => getTimeline(ctx, input),
});
