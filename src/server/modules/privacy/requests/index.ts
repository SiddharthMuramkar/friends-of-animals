// Privacy rights requests and the grievance queue (#115), beside the
// privacy module's inventory and retention: a data principal, or a
// guardian for a child, files an access, correction or erasure request;
// FOA's grievance officer answers it on time. Its use cases join
// `as(actor)` through `privacyRequestUseCases`.
//
// Loads under plain Node: relative imports only, no "server-only".

import type { UseCaseContext } from "../../../use-cases";
import {
  cancelPrivacyRequest,
  getMyPrivacyRequest,
  listMyPrivacyRequests,
} from "./my-requests";
import { flagOverduePrivacyRequests } from "./overdue";
import {
  getGrievanceRequest,
  listGrievanceQueue,
  type QueueFilter,
} from "./queue";
import { submitPrivacyRequest, type SubmitPrivacyRequestInput } from "./submit";
import {
  addPrivacyRequestNote,
  assignPrivacyRequest,
  completeCorrection,
  rejectPrivacyRequest,
  startPrivacyRequest,
} from "./work";

export type {
  CancelPrivacyRequestResult,
  MyRequestItem,
  MyRequestView,
  RequestAbout,
} from "./my-requests";
export type {
  SubmitPrivacyRequestInput,
  SubmitPrivacyRequestResult,
} from "./submit";
export type { ExportView } from "./export-view";
export type {
  GetGrievanceRequestResult,
  GrievanceNote,
  GrievanceRequestView,
  ListGrievanceQueueResult,
  QueueFilter,
  QueueItem,
} from "./queue";
export type {
  AddPrivacyRequestNoteResult,
  AssignPrivacyRequestResult,
  CompleteCorrectionResult,
  MoveResult,
} from "./work";
export type { PersonRef } from "./people";
export type { RequestEvent } from "./domain/request-status";
export {
  CORRECTION_DETAILS_MAX,
  NOTE_MAX,
  REJECTION_REASON_MAX,
  RESOLUTION_MAX,
} from "./content";
export {
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
} from "./domain/request-status";

export const privacyRequestUseCases = (ctx: UseCaseContext) => ({
  submitPrivacyRequest: (input: SubmitPrivacyRequestInput) =>
    submitPrivacyRequest(ctx, input),
  listMyPrivacyRequests: () => listMyPrivacyRequests(ctx),
  getMyPrivacyRequest: (input: { id: string }) =>
    getMyPrivacyRequest(ctx, input),
  cancelPrivacyRequest: (input: { id: string }) =>
    cancelPrivacyRequest(ctx, input),
  listGrievanceQueue: (input?: QueueFilter) => listGrievanceQueue(ctx, input),
  getGrievanceRequest: (input: { id: string }) =>
    getGrievanceRequest(ctx, input),
  assignPrivacyRequest: (input: { id: string; assigneeUserId: string }) =>
    assignPrivacyRequest(ctx, input),
  startPrivacyRequest: (input: { id: string }) =>
    startPrivacyRequest(ctx, input),
  addPrivacyRequestNote: (input: { id: string; body: string }) =>
    addPrivacyRequestNote(ctx, input),
  rejectPrivacyRequest: (input: { id: string; reason: string }) =>
    rejectPrivacyRequest(ctx, input),
  completeCorrection: (input: { id: string; resolution: string }) =>
    completeCorrection(ctx, input),
  flagOverduePrivacyRequests: () => flagOverduePrivacyRequests(ctx),
});
