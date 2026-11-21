// The outbox module: use cases save events with `emit`, and the relay
// delivers them (the VPS worker, the preview drain route, `h.drain()`).
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

export { emit } from "./emit";
export type { DomainEvent, EventType, HandlerName } from "./events";
export {
  DEFAULT_DRAIN_LIMIT,
  drainOutbox,
  drainUntilIdle,
  type DrainReport,
  type OutboxDeps,
} from "./relay";
