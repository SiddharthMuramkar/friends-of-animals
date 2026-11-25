// The volunteers module (#123): applying to volunteer, a guardian's
// approval for a 14- to 17-year-old, and the community team's vetting,
// whose approval grants the global volunteer role. Its use cases join
// `as(actor)` through `volunteersUseCases`. #124 adds tasks, hours and
// certificates for volunteers.

import type { UseCaseContext } from "../../use-cases";
import {
  acceptVolunteerDeclarations,
  applyToVolunteer,
  type ApplyToVolunteerInput,
} from "./apply";
import {
  approveVolunteer,
  decideAsGuardian,
  declineVolunteer,
  withdrawVolunteerApplication,
} from "./decide";
import type { AcceptedDeclarations } from "./declarations";
import {
  childVolunteerApplication,
  getVolunteerApplication,
  listVolunteerApplications,
  myVolunteerApplication,
} from "./read";

export type {
  AcceptVolunteerDeclarationsResult,
  ApplyToVolunteerInput,
  ApplyToVolunteerResult,
} from "./apply";
export type {
  ApproveVolunteerResult,
  DecideAsGuardianResult,
  DeclineVolunteerResult,
  WithdrawVolunteerApplicationResult,
} from "./decide";
export type { DeclarationKey, DeclarationStanding } from "./declarations";
export type {
  ChildVolunteerApplicationResult,
  GetVolunteerApplicationResult,
  ListVolunteerApplicationsResult,
  MyVolunteerApplication,
  VolunteerApplicationDetail,
  VolunteerApplicationSummary,
  VolunteerApplicationView,
} from "./read";

import {
  createVolunteerTask,
  changeVolunteerTask,
  listVolunteerTasks,
  logVolunteerHours,
  decideVolunteerHours,
  getMyVolunteerRecord,
  getChildVolunteerRecord,
  listVolunteerHours,
} from "./work";

import { requestVolunteerCertificate } from "./certificate";

export const volunteersUseCases = (ctx: UseCaseContext) => ({
  requestVolunteerCertificate: () => requestVolunteerCertificate(ctx),
  createVolunteerTask: (input: Parameters<typeof createVolunteerTask>[1]) =>
    createVolunteerTask(ctx, input),
  publishVolunteerTask: (input: { taskId: string }) =>
    changeVolunteerTask(ctx, "publish", input),
  assignVolunteerTask: (input: { taskId: string; volunteerUserId: string }) =>
    changeVolunteerTask(ctx, "assign", input),
  unassignVolunteerTask: (input: { taskId: string; volunteerUserId: string }) =>
    changeVolunteerTask(ctx, "unassign", input),
  cancelVolunteerTask: (input: { taskId: string }) =>
    changeVolunteerTask(ctx, "cancel", input),
  startVolunteerTask: (input: { taskId: string }) =>
    changeVolunteerTask(ctx, "start", input),
  completeVolunteerTask: (input: { taskId: string }) =>
    changeVolunteerTask(ctx, "complete", input),
  listVolunteerTasks: () => listVolunteerTasks(ctx),
  logVolunteerHours: (input: Parameters<typeof logVolunteerHours>[1]) =>
    logVolunteerHours(ctx, input),
  approveVolunteerHours: (input: { entryId: string }) =>
    decideVolunteerHours(ctx, input, "approve"),
  rejectVolunteerHours: (input: { entryId: string; reason: string }) =>
    decideVolunteerHours(ctx, input, "reject"),
  getMyVolunteerRecord: () => getMyVolunteerRecord(ctx),
  getChildVolunteerRecord: (input: { childId: string }) =>
    getChildVolunteerRecord(ctx, input),
  listVolunteerHours: () => listVolunteerHours(ctx),
  applyToVolunteer: (input: ApplyToVolunteerInput) =>
    applyToVolunteer(ctx, input),
  acceptVolunteerDeclarations: (input: AcceptedDeclarations) =>
    acceptVolunteerDeclarations(ctx, input),
  myVolunteerApplication: () => myVolunteerApplication(ctx),
  childVolunteerApplication: (input: { childId: string }) =>
    childVolunteerApplication(ctx, input),
  decideAsGuardian: (input: {
    applicationId: string;
    decision: "approve" | "decline";
  }) => decideAsGuardian(ctx, input),
  withdrawVolunteerApplication: (input: { applicationId: string }) =>
    withdrawVolunteerApplication(ctx, input),
  listVolunteerApplications: (input?: { status?: string }) =>
    listVolunteerApplications(ctx, input),
  getVolunteerApplication: (input: { applicationId: string }) =>
    getVolunteerApplication(ctx, input),
  approveVolunteer: (input: { applicationId: string }) =>
    approveVolunteer(ctx, input),
  declineVolunteer: (input: { applicationId: string; reason: string }) =>
    declineVolunteer(ctx, input),
});
