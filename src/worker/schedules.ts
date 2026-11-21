// Stub.
import type { OutboxDeps, ScheduleDefinition } from "../server/outbox";

export type ScheduleBoss = {
  getSchedules(): Promise<{ name: string; key: string }[]>;
  unschedule(name: string): Promise<void>;
  createQueue(name: string): Promise<void>;
  schedule(
    name: string,
    cron: string,
    data: object | null,
    options: { tz: string }
  ): Promise<void>;
  work(name: string, handler: (jobs: unknown[]) => Promise<unknown>): Promise<string>;
};

export async function registerSchedules(
  _boss: ScheduleBoss,
  _schedules: readonly ScheduleDefinition[],
  _deps: OutboxDeps
): Promise<void> {}
