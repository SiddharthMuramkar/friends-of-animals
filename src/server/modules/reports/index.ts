import type { UseCaseContext } from "../../use-cases";
import { getAdminHome, listQueueItems, type ListQueueItemsInput } from "./queues";
import { listReportCompetitions, getCompetitionReport, exportCompetitionReportCsv, type CompetitionReportInput } from "./competition-report";
export const reportsUseCases = (ctx: UseCaseContext) => ({
  listReportCompetitions: () => listReportCompetitions(ctx),
  getCompetitionReport: (input:CompetitionReportInput) => getCompetitionReport(ctx,input),
  exportCompetitionReportCsv: (input:CompetitionReportInput) => exportCompetitionReportCsv(ctx,input),
  getAdminHome: () => getAdminHome(ctx),
  listQueueItems: (input: ListQueueItemsInput) => listQueueItems(ctx, input),
});
