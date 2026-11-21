// The safeguarding module (#116): the public "report a concern" form and
// the safeguarding lead's queue. Its use cases join `as(actor)` through
// `safeguardingUseCases`.

export { safeguardingUseCases } from "./use-cases";
export type {
  AddIncidentLogEntryResult,
  AssignSafeguardingReportResult,
  MoveSafeguardingReportResult,
} from "./handling";
export type {
  IncidentLogEntryView,
  ListSafeguardingReportsResult,
  PersonRef,
  QueueItem,
  QueueView,
  SafeguardingReportView,
  ViewSafeguardingReportResult,
} from "./queue";
export type { ConcernCategory } from "./domain/concern";
export type {
  ReportAction,
  ReportEvent,
  SafeguardingReportStatus,
  SafeguardingSeverity,
} from "./domain/report-status";
