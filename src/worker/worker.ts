// Stub.
import type { AppDb } from "../server/db/app-db";
import type { Clock } from "../server/ports/clock";
import type { WorkerConfig } from "./config";
import type { WorkerLog } from "./log";
import type { ListedDatabase } from "./preview-databases";
import type { ScheduleBoss } from "./schedules";

export type WorkerIo = {
  clock: Clock;
  log: WorkerLog;
  openDatabase(
    url: string,
    connections: number
  ): { db: AppDb; end(): Promise<void> };
  openCatalog(adminUrl: string): {
    list(): Promise<ListedDatabase[]>;
    end(): Promise<void>;
  };
  startBoss(url: string): Promise<ScheduleBoss & { stop(): Promise<void> }>;
  beat(at: Date): Promise<void>;
};

export type Worker = {
  start(): Promise<void>;
  tick(): Promise<void>;
  stop(): Promise<void>;
};

export function createWorker(_config: WorkerConfig, _io: WorkerIo): Worker {
  return { start: async () => {}, tick: async () => {}, stop: async () => {} };
}
