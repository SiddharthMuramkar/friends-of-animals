// The outbox module: use cases save events with `emit`, and the relay
// delivers them (the VPS worker, the preview drain route, `h.drain()`).
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

export { emit } from "./emit";
export type { DomainEvent, EventType, HandlerName } from "./events";
export type { Delivery } from "./handlers";
export {
  DEFAULT_DRAIN_LIMIT,
  drainOutbox,
  DrainNeverIdleError,
  drainUntilIdle,
  listFailedDeliveries,
  type DrainOptions,
  type DrainReport,
  type FailedDelivery,
  type OutboxDeps,
} from "./relay";
export { DEFAULT_RETRY_POLICY, type RetryPolicy } from "./retry-policy";
export {
  SCHEDULES,
  scheduleProblems,
  type ScheduleDefinition,
} from "./schedules";
