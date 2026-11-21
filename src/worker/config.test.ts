import { describe, expect, it } from "vitest";

import { workerConfig } from "./config";

const PROD_URL = "postgres://foa_worker:s3cret-pw@10.112.12.10:5432/foa";
const ADMIN_URL =
  "postgres://nonprod_worker:s3cret-pw@10.112.12.11:5432/postgres";

describe("workerConfig", () => {
  it("serves one database in single mode, with the defaults", () => {
    expect(
      workerConfig({
        WORKER_MODE: "single",
        APP_ENV: "production",
        WORKER_DATABASE_URL: PROD_URL,
      })
    ).toEqual({
      mode: "single",
      databaseUrl: PROD_URL,
      database: "foa",
      appEnv: "production",
      identity: {
        worker: "worker-prod",
        environment: "production",
        version: "dev",
      },
      pollMs: 5_000,
      discoveryMs: 60_000,
      connectionsPerDatabase: 1,
      heartbeatFile: "/tmp/foa-worker-heartbeat",
    });
  });

  it("serves the preview databases in preview mode", () => {
    expect(
      workerConfig({
        WORKER_MODE: "preview",
        APP_ENV: "preview",
        WORKER_ADMIN_URL: ADMIN_URL,
        WORKER_POLL_SECONDS: "10",
        WORKER_DISCOVERY_SECONDS: "30",
        WORKER_CONNECTIONS_PER_DATABASE: "2",
        WORKER_HEARTBEAT_FILE: "/run/worker/heartbeat",
        WORKER_VERSION: "9af49ce",
      })
    ).toEqual({
      mode: "preview",
      adminUrl: ADMIN_URL,
      appEnv: "preview",
      identity: {
        worker: "worker-preview",
        environment: "preview",
        version: "9af49ce",
      },
      pollMs: 10_000,
      discoveryMs: 30_000,
      connectionsPerDatabase: 2,
      heartbeatFile: "/run/worker/heartbeat",
    });
  });

  it("names the worker after its environment", () => {
    const name = (APP_ENV: string) =>
      workerConfig({
        WORKER_MODE: "single",
        APP_ENV,
        WORKER_DATABASE_URL: PROD_URL,
      }).identity.worker;

    expect(name("staging")).toBe("worker-staging");
    expect(name("local")).toBe("worker-local");
  });

  it("runs locally against DIRECT_URL by default", () => {
    const local = "postgres://foa:foa@localhost:5432/foa";

    const config = workerConfig({ APP_ENV: "local", DIRECT_URL: local });

    expect(config).toMatchObject({
      mode: "single",
      databaseUrl: local,
      database: "foa",
      appEnv: "local",
    });
  });

  it("falls back to DIRECT_URL only on a local run", () => {
    expect(() =>
      workerConfig({ APP_ENV: "staging", DIRECT_URL: PROD_URL })
    ).toThrow(/WORKER_DATABASE_URL/);
  });

  it("treats empty variables as unset", () => {
    expect(() =>
      workerConfig({
        WORKER_MODE: "single",
        APP_ENV: "production",
        WORKER_DATABASE_URL: "",
      })
    ).toThrow(/WORKER_DATABASE_URL/);
  });

  it("refuses a preview worker without the admin connection", () => {
    expect(() =>
      workerConfig({ WORKER_MODE: "preview", APP_ENV: "preview" })
    ).toThrow(/WORKER_ADMIN_URL/);
  });

  it("refuses to mix up preview mode and the preview environment", () => {
    expect(() =>
      workerConfig({
        WORKER_MODE: "preview",
        APP_ENV: "staging",
        WORKER_ADMIN_URL: ADMIN_URL,
      })
    ).toThrow(/APP_ENV/);
    expect(() =>
      workerConfig({
        WORKER_MODE: "single",
        APP_ENV: "preview",
        WORKER_DATABASE_URL: PROD_URL,
      })
    ).toThrow(/WORKER_MODE/);
  });

  it("caps each database at two connections", () => {
    expect(() =>
      workerConfig({
        WORKER_MODE: "preview",
        APP_ENV: "preview",
        WORKER_ADMIN_URL: ADMIN_URL,
        WORKER_CONNECTIONS_PER_DATABASE: "3",
      })
    ).toThrow(/WORKER_CONNECTIONS_PER_DATABASE/);
  });

  it("refuses unknown modes, environments and non-Postgres URLs", () => {
    expect(() =>
      workerConfig({ WORKER_MODE: "all", APP_ENV: "local" })
    ).toThrow(/WORKER_MODE/);
    expect(() =>
      workerConfig({
        WORKER_MODE: "single",
        APP_ENV: "prod",
        WORKER_DATABASE_URL: PROD_URL,
      })
    ).toThrow(/APP_ENV/);
    expect(() =>
      workerConfig({
        WORKER_MODE: "single",
        APP_ENV: "production",
        WORKER_DATABASE_URL: "https://example.test/foa",
      })
    ).toThrow(/WORKER_DATABASE_URL/);
  });

  it("never repeats a URL, and so its password, in an error", () => {
    let message = "";
    try {
      workerConfig({
        WORKER_MODE: "preview",
        APP_ENV: "staging",
        WORKER_ADMIN_URL: ADMIN_URL,
        WORKER_DATABASE_URL: "mysql://u:s3cret-pw@db/foa",
      });
    } catch (error) {
      message = String(error);
    }

    expect(message).toMatch(/APP_ENV/);
    expect(message).not.toContain("s3cret-pw");
  });
});
