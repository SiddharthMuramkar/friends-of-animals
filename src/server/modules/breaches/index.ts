// The breach log (#116): personal-data breaches, their timeline, and the
// notices to affected people and the authority. Its use cases join
// `as(actor)` through `breachesUseCases`.

export { breachesUseCases } from "./use-cases";
export type { RecordBreachResult } from "./record";
export {
  BREACH_IMPACT_MAX,
  BREACH_NOTE_MAX,
  BREACH_SEVERITIES,
  BREACH_TITLE_MAX,
  NO_NOTICE_REASON_MAX,
} from "./domain/breach-status";
export type {
  BreachEvent,
  BreachSeverity,
  BreachStatus,
  BreachTimelineKind,
} from "./domain/breach-status";
