// Stub.
import type { WorkerIdentity } from "./tenant";

type Common = {
  appEnv: WorkerIdentity["environment"];
  identity: WorkerIdentity;
  pollMs: number;
  discoveryMs: number;
  connectionsPerDatabase: number;
  heartbeatFile: string;
};

export type WorkerConfig =
  | (Common & { mode: "single"; databaseUrl: string; database: string })
  | (Common & { mode: "preview"; adminUrl: string });

export function workerConfig(
  _source: Record<string, string | undefined>
): WorkerConfig {
  return {
    mode: "single",
    databaseUrl: "",
    database: "",
    appEnv: "local",
    identity: { worker: "", environment: "local", version: "" },
    pollMs: 0,
    discoveryMs: 0,
    connectionsPerDatabase: 0,
    heartbeatFile: "",
  };
}
