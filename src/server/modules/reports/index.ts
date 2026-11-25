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
import {
  getObjectiveReport,
  exportObjectiveReportCsv,
  type ObjectivePeriodInput,
} from "./objectives";
export const reportsUseCases = (ctx: UseCaseContext) => ({
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
