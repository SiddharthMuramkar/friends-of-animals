// emit(tx, clock, event): saves a domain event in the caller's transaction.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import type { AppDb } from "../db/app-db";
import type { Clock } from "../ports/clock";
import type { DomainEvent } from "./events";

export async function emit(
  _tx: AppDb,
  _clock: Clock,
  _event: DomainEvent,
  _options: { availableAt?: Date } = {}
): Promise<void> {}
