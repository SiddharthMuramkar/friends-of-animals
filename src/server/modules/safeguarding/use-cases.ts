// The safeguarding module's use cases, as `as(actor)` exposes them (#116).

import type { UseCaseContext } from "../../use-cases";
import {
  addIncidentLogEntry,
  assignSafeguardingReport,
  moveSafeguardingReport,
} from "./handling";
import type { ReportAction } from "./domain/report-status";
import {
  listSafeguardingReports,
  viewSafeguardingReport,
  type QueueView,
} from "./queue";
import {
  submitSafeguardingReport,
  type SubmitSafeguardingReportInput,
} from "./submit";

export const safeguardingUseCases = (ctx: UseCaseContext) => ({
  submitSafeguardingReport: (input: SubmitSafeguardingReportInput) =>
    submitSafeguardingReport(ctx, input),
  listSafeguardingReports: (input?: { view?: QueueView }) =>
    listSafeguardingReports(ctx, input),
  viewSafeguardingReport: (input: { reportId: string }) =>
    viewSafeguardingReport(ctx, input),
  moveSafeguardingReport: (input: { reportId: string; action: ReportAction }) =>
    moveSafeguardingReport(ctx, input),
  assignSafeguardingReport: (input: {
    reportId: string;
    assigneeUserId: string | null;
  }) => assignSafeguardingReport(ctx, input),
  addIncidentLogEntry: (input: { reportId: string; body: string }) =>
    addIncidentLogEntry(ctx, input),
});
