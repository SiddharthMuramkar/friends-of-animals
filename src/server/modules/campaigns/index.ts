// The campaigns module (#126): a community manager writes a message once,
// previews who its segment holds (only people with current consent) and
// sends it through the outbox; every message carries a withdrawal link.
// The worker's handler is ./deliver.ts. Its use cases join `as(actor)`
// through `campaignsUseCases`.

import type { UseCaseContext } from "../../use-cases";
import {
  createCampaign,
  getCampaign,
  listCampaigns,
  listSegmentCompetitions,
  updateCampaign,
  type CampaignDraftInput,
  type CampaignTarget,
} from "./use-cases/drafts";
import { previewCampaign, previewSegment } from "./use-cases/preview";
import { sendCampaign } from "./use-cases/send";
import { viewWithdrawalLink, withdrawByLink } from "./use-cases/withdrawal";

export type {
  CampaignDraftInput,
  CampaignSummary,
  CampaignView,
  CreateCampaignResult,
  GetCampaignResult,
  ListCampaignsResult,
  SegmentCompetition,
  UpdateCampaignResult,
} from "./use-cases/drafts";
export type {
  CampaignPreview,
  PreviewCampaignResult,
  PreviewSegmentResult,
} from "./use-cases/preview";
export type { SendCampaignResult } from "./use-cases/send";
export type { DeliveryCounts } from "./delivery-counts";
export type {
  WithdrawalLinkView,
  WithdrawByLinkResult,
} from "./use-cases/withdrawal";
export type { AudienceCounts } from "./domain/audience";
export type { CampaignStatus } from "./domain/campaign";
export type { SegmentDefinition, SegmentRole } from "./domain/segment";
export { SEGMENT_LIMITS, SEGMENT_ROLES } from "./domain/segment";
export { CAMPAIGN_LIMITS } from "./domain/campaign";
export { CAMPAIGNS_POLICY, type CampaignsAction } from "./policy";

export const campaignsUseCases = (ctx: UseCaseContext) => ({
  createCampaign: (input: CampaignDraftInput) => createCampaign(ctx, input),
  updateCampaign: (
    input: CampaignTarget & { revision: number } & CampaignDraftInput
  ) => updateCampaign(ctx, input),
  getCampaign: (input: CampaignTarget) => getCampaign(ctx, input),
  listCampaigns: () => listCampaigns(ctx),
  listSegmentCompetitions: () => listSegmentCompetitions(ctx),
  previewCampaign: (input: CampaignTarget) => previewCampaign(ctx, input),
  previewSegment: (input: { segment: unknown }) => previewSegment(ctx, input),
  sendCampaign: (input: CampaignTarget & { revision: number }) =>
    sendCampaign(ctx, input),
  viewWithdrawalLink: (input: { token: string }) =>
    viewWithdrawalLink(ctx, input),
  withdrawByLink: (input: { token: string }) => withdrawByLink(ctx, input),
});
