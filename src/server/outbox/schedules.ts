// Recurring jobs. The VPS worker registers each one as a pg-boss schedule
// (#61's worker runtime). Empty until a ticket adds one.
//
// Loads under plain Node (the worker): no "server-only", no Next imports.

import type { OutboxDeps } from "./handlers";

export type ScheduleDefinition = {
  name: string;
  cron: string;
  tz: "Asia/Kolkata" | "UTC";
  run(deps: OutboxDeps): Promise<void>;
};

export const SCHEDULES: readonly ScheduleDefinition[] = [];

export function scheduleProblems(
  _schedules: readonly ScheduleDefinition[]
): string[] {
  return [];
}
