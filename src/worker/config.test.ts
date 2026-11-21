import { describe, expect, it } from "vitest";

import { withPassword, workerConfig } from "./config";

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
      passwordFile: undefined,
      queue: { name: "default" },
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
        WORKER_PASSWORD_FILE: "/run/secrets/db_password",
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
      passwordFile: "/run/secrets/db_password",
      queue: { name: "default" },
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

  it("runs worker-media on the media queue, with a time limit per job", () => {
    expect(
      workerConfig({
        WORKER_MODE: "single",
        APP_ENV: "production",
        WORKER_DATABASE_URL: PROD_URL,
        WORKER_QUEUE: "media",
        MEDIA_TIMEOUT_SECONDS: "90",
      })
    ).toMatchObject({
      mode: "single",
      queue: { name: "media", timeoutSeconds: 90 },
      identity: { worker: "worker-media", environment: "production" },
    });
  });

  it("gives a media job 60 seconds unless told otherwise", () => {
    const media = (APP_ENV: string) =>
      workerConfig({
        WORKER_MODE: "single",
        APP_ENV,
        WORKER_DATABASE_URL: PROD_URL,
        WORKER_QUEUE: "media",
      });

    expect(media("staging")).toMatchObject({
      queue: { name: "media", timeoutSeconds: 60 },
      identity: { worker: "worker-media-staging" },
    });
    expect(media("local").identity.worker).toBe("worker-media-local");
  });

  it("refuses a media job time limit its outbox lease can't cover", () => {
    // The relay's lease is 5 minutes; the job also reads and writes
    // storage inside it.
    for (const MEDIA_TIMEOUT_SECONDS of ["0", "241", "soon"]) {
      expect(() =>
        workerConfig({
          WORKER_MODE: "single",
          APP_ENV: "production",
          WORKER_DATABASE_URL: PROD_URL,
          WORKER_QUEUE: "media",
          MEDIA_TIMEOUT_SECONDS,
        })
      ).toThrow(/MEDIA_TIMEOUT_SECONDS/);
    }
    expect(() =>
      workerConfig({
        WORKER_MODE: "single",
        APP_ENV: "production",
        WORKER_DATABASE_URL: PROD_URL,
        WORKER_QUEUE: "scans",
      })
    ).toThrow(/WORKER_QUEUE/);
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

describe("the worker's error tracking setting", () => {
  const DSN = "https://abc123@o1.ingest.us.sentry.io/4507";
  const staging = {
    APP_ENV: "staging",
    WORKER_DATABASE_URL: PROD_URL,
  };

  it("is off without SENTRY_DSN", () => {
    expect(workerConfig(staging).sentryDsn).toBeUndefined();
  });

  it("sends to SENTRY_DSN", () => {
    expect(workerConfig({ ...staging, SENTRY_DSN: DSN }).sentryDsn).toBe(DSN);
  });

  it("refuses a malformed SENTRY_DSN without repeating it", () => {
    const bad = "https://sentry.example.test/not-a-project";
    let message = "";
    try {
      workerConfig({ ...staging, SENTRY_DSN: bad });
    } catch (error) {
      message = String(error);
    }

    expect(message).toMatch(/^Error: Invalid environment/);
    expect(message).toMatch(/SENTRY_DSN/);
    expect(message).not.toContain(bad);
  });
});

describe("withPassword", () => {
  it("puts the password from the secret file into the database URL", () => {
    const config = workerConfig({
      WORKER_MODE: "single",
      APP_ENV: "staging",
      WORKER_DATABASE_URL:
        "postgres://staging_worker@10.112.12.11:5432/foa_staging",
    });

    expect(withPassword(config, "0a1b2c\n")).toMatchObject({
      databaseUrl:
        "postgres://staging_worker:0a1b2c@10.112.12.11:5432/foa_staging",
      database: "foa_staging",
    });
  });

  it("puts it into the preview worker's admin URL", () => {
    const config = workerConfig({
      WORKER_MODE: "preview",
      APP_ENV: "preview",
      WORKER_ADMIN_URL: "postgres://nonprod_worker@10.112.12.11:5432/postgres",
    });

    expect(withPassword(config, "p@ss/word")).toMatchObject({
      adminUrl:
        "postgres://nonprod_worker:p%40ss%2Fword@10.112.12.11:5432/postgres",
    });
  });
});
