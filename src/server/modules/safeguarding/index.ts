// The safeguarding module (#116): the public "report a concern" form and
// the safeguarding lead's queue. Its use cases join `as(actor)` through
// `safeguardingUseCases`.

export { safeguardingUseCases } from "./use-cases";
export {
  AUTHORITY_REFERENCE_MAX,
  OUTCOME_MAX,
  SAFEGUARDING_SEVERITIES,
} from "./domain/report-status";
export { NOTE_MAX } from "./handling";
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
export type {
  SubmitSafeguardingReportInput,
  SubmitSafeguardingReportResult,
} from "./submit";
export type { ConcernCategory, ConcernField } from "./domain/concern";
export type {
  ReportAction,
  ReportEvent,
  SafeguardingReportStatus,
  SafeguardingSeverity,
} from "./domain/report-status";
