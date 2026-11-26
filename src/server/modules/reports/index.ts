import type { UseCaseContext } from "../../use-cases";
import {
  getAdminHome,
  listQueueItems,
  type ListQueueItemsInput,
} from "./queues";
import {
  listReportCompetitions,
  getCompetitionReport,
  exportCompetitionReportCsv,
  type CompetitionReportInput,
} from "./competition-report";
import { getObjectiveReport, exportObjectiveReportCsv } from "./objectives";
import type { ObjectivePeriodInput } from "./domain/period";
import type { SocialSnapshotInput } from "./domain/social-snapshot";
import {
  recordSocialSnapshot,
  getSocialReport,
  exportSocialReportCsv,
} from "./social";
export const reportsUseCases = (ctx: UseCaseContext) => ({
  recordSocialSnapshot: (input: SocialSnapshotInput) =>
    recordSocialSnapshot(ctx, input),
  getSocialReport: (input: ObjectivePeriodInput) => getSocialReport(ctx, input),
  exportSocialReportCsv: (input: ObjectivePeriodInput) =>
    exportSocialReportCsv(ctx, input),
  getObjectiveReport: (input: ObjectivePeriodInput) =>
    getObjectiveReport(ctx, input),
  exportObjectiveReportCsv: (input: ObjectivePeriodInput) =>
    exportObjectiveReportCsv(ctx, input),
  listReportCompetitions: () => listReportCompetitions(ctx),
  getCompetitionReport: (input: CompetitionReportInput) =>
    getCompetitionReport(ctx, input),
  exportCompetitionReportCsv: (input: CompetitionReportInput) =>
    exportCompetitionReportCsv(ctx, input),
  getAdminHome: () => getAdminHome(ctx),
  listQueueItems: (input: ListQueueItemsInput) => listQueueItems(ctx, input),
});
