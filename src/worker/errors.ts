import type { EventEmitter } from "node:events";

import type { SentryOptions } from "../lib/observability/config";
import { silentErrorReporter, type ErrorReporter } from "../server/ports/errors";
import type { SentrySdk } from "../server/ports/errors-sentry";

export type WorkerSentryOptions = SentryOptions & {
  integrations: <T extends { name: string }>(defaults: T[]) => T[];
};

export type WorkerSentrySdk = SentrySdk & {
  init(options: WorkerSentryOptions): unknown;
};

type ErrorLog = (entry: {
  level: "error";
  event: string;
  error?: string;
}) => void;

export type WorkerErrors = {
  reporter: ErrorReporter;
  tenantFailed(error: unknown, where: { tenant: string }): void;
  flush(): Promise<boolean>;
};

export async function startWorkerErrors(_input: {
  dsn: string | undefined;
  appEnv: string;
  release?: string | undefined;
  loadSdk: () => Promise<WorkerSentrySdk>;
  log: ErrorLog;
}): Promise<WorkerErrors> {
  return {
    reporter: silentErrorReporter,
    tenantFailed: () => {},
    flush: async () => true,
  };
}

export function exitOnUncaught(
  _reporter: ErrorReporter,
  _io: {
    process: Pick<EventEmitter, "on">;
    exit: (code: number) => void;
    log: ErrorLog;
  }
): void {}
