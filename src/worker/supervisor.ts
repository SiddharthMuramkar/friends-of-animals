// Stub.
import type { Clock } from "../server/ports/clock";
import type { WorkerLog } from "./log";
import type { Tenant } from "./tenant";

export type Supervisor = {
  tick(): Promise<void>;
  serving(): string[];
  stop(): Promise<void>;
};

export function createSupervisor(_options: {
  clock: Clock;
  discoveryIntervalMs: number;
  everyTenantMustTick: boolean;
  listDatabases(): Promise<readonly string[]>;
  startTenant(database: string): Promise<Tenant>;
  beat(at: Date): Promise<void>;
  log: WorkerLog;
}): Supervisor {
  return { tick: async () => {}, serving: () => [], stop: async () => {} };
}
