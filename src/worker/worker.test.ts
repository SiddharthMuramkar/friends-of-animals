import { describe, expect, it } from "vitest";

import type { AppDb } from "@/server/db/app-db";
import { capturedMessage, outbox, workerHeartbeat } from "@/server/db/schema";
import { emitUserSignedUp } from "@/server/outbox/testing";
import { createTestDb } from "@/test/db";
import { FakeClock } from "@/test/fakes/clock";
import { createHarness } from "@/test/harness";

import type { WorkerConfig } from "./config";
import type { WorkerLogEntry } from "./log";
import type { ListedDatabase } from "./preview-databases";
import { createWorker, type WorkerIo } from "./worker";

const DB_URL = "postgres://foa_worker:pw@10.112.12.10:5432/foa";
const ADMIN_URL = "postgres://nonprod_worker:pw@10.112.12.11:5432/postgres";

const COMMON = {
  pollMs: 5_000,
  discoveryMs: 60_000,
  heartbeatFile: "/tmp/foa-worker-heartbeat",
  passwordFile: undefined,
} as const;

function singleConfig(
  appEnv: "local" | "staging" | "production" = "local"
): WorkerConfig {
  return {
    ...COMMON,
    mode: "single",
    databaseUrl: DB_URL,
    database: "foa",
    appEnv,
    identity: {
      worker: `worker-${appEnv}`,
      environment: appEnv,
      version: "dev",
    },
    connectionsPerDatabase: 1,
  };
}

const PREVIEW_CONFIG: WorkerConfig = {
  ...COMMON,
  mode: "preview",
  adminUrl: ADMIN_URL,
  appEnv: "preview",
  identity: {
    worker: "worker-preview",
    environment: "preview",
    version: "9af49ce",
  },
  connectionsPerDatabase: 2,
};

/** A database whose every query fails (its connection is closed). */
async function brokenDb(): Promise<AppDb> {
  const db = await createTestDb();
  await db.$client.close();
  return db;
}

/**
 * Fake I/O: `databases` maps a URL's database name to a test database;
 * `catalog` is what pg-nonprod lists. Records what the worker opened.
 */
function fakeIo(
  databases: Record<string, AppDb>,
  catalog: ListedDatabase[] = []
) {
  const record = {
    opened: [] as { url: string; connections: number }[],
    ended: [] as string[],
    bossStartedOn: [] as string[],
    bossCalls: [] as string[],
    bossStopped: 0,
    catalogEnded: 0,
    beats: [] as Date[],
    log: [] as WorkerLogEntry[],
    errors: [] as { error: unknown; tenant: string }[],
  };
  const io: WorkerIo = {
    clock: new FakeClock(),
    log: (entry) => record.log.push(entry),
    onTenantError: (error, { tenant }) => record.errors.push({ error, tenant }),
    openDatabase(url, connections) {
      record.opened.push({ url, connections });
      const name = new URL(url).pathname.slice(1);
      const db = databases[name];
      if (!db) throw new Error(`No test database named ${name}`);
      return {
        db,
        end: async () => {
          record.ended.push(name);
        },
      };
    },
    openCatalog(url) {
      expect(url).toBe(ADMIN_URL);
      return {
        list: async () => catalog,
        end: async () => {
          record.catalogEnded += 1;
        },
      };
    },
    async startBoss(url) {
      record.bossStartedOn.push(url);
      return {
        getSchedules: async () => {
          record.bossCalls.push("getSchedules");
          return [];
        },
        unschedule: async () => {},
        createQueue: async () => {},
        schedule: async () => {},
        work: async () => "",
        stop: async () => {
          record.bossStopped += 1;
        },
      };
    },
    async beat(at) {
      record.beats.push(at);
    },
  };
  return { io, record };
}

describe("a single-database worker", () => {
  it("drains its database, captures the email and beats", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    await emitUserSignedUp(h, member.id);
    const { io, record } = fakeIo({ foa: h.db });

    const worker = createWorker(singleConfig("local"), io);
    await worker.start();
    await worker.tick();

    const captured = await h.db.select().from(capturedMessage);
    expect(captured.map((m) => [m.toAddress, m.subject])).toEqual([
      [member.email, "Welcome to Friends of Animals"],
    ]);
    expect(await h.db.select().from(workerHeartbeat)).toEqual([
      expect.objectContaining({ worker: "worker-local", environment: "local" }),
    ]);
    expect(record.opened).toEqual([{ url: DB_URL, connections: 1 }]);
    expect(record.beats).toEqual([io.clock.now()]);
  });

  it("registers the schedules with pg-boss on its database", async () => {
    const h = await createHarness();
    const { io, record } = fakeIo({ foa: h.db });

    const worker = createWorker(singleConfig("staging"), io);
    await worker.start();
    await worker.stop();

    expect(record.bossStartedOn).toEqual([DB_URL]);
    expect(record.bossCalls).toEqual(["getSchedules"]);
    expect(record.bossStopped).toBe(1);
    expect(record.ended.length).toBeGreaterThan(0);
  });

  it("refuses to send in production while no provider is set up", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    await emitUserSignedUp(h, member.id);
    const { io } = fakeIo({ foa: h.db });

    const worker = createWorker(singleConfig("production"), io);
    await worker.start();
    await worker.tick();

    expect(await h.db.select().from(capturedMessage)).toEqual([]);
    const [delivery] = await h.db.select().from(outbox);
    expect(delivery).toMatchObject({ status: "pending", attempts: 1 });
    expect(delivery?.lastError).toContain("EmailNotConfiguredError");
  });
});

describe("a worker's failed ticks", () => {
  it("are reported with the database in single mode", async () => {
    const { io, record } = fakeIo({ foa: await brokenDb() });

    const worker = createWorker(singleConfig("staging"), io);
    await worker.start();
    await worker.tick();

    expect(record.errors).toEqual([
      { error: expect.any(Error), tenant: "foa" },
    ]);
  });

  it("are reported for the one broken preview only", async () => {
    const pr1 = await createHarness();
    const { io, record } = fakeIo(
      { foa_pr_1_0a1b2c3d: pr1.db, foa_pr_2_0a1b2c3d: await brokenDb() },
      [
        { datname: "foa_pr_1_0a1b2c3d", comment: "foa-preview pr=1" },
        { datname: "foa_pr_2_0a1b2c3d", comment: "foa-preview pr=2" },
      ]
    );

    const worker = createWorker(PREVIEW_CONFIG, io);
    await worker.start();
    await worker.tick();

    expect(record.errors).toEqual([
      { error: expect.any(Error), tenant: "foa_pr_2_0a1b2c3d" },
    ]);
  });
});

describe("the shared preview worker", () => {
  const catalog: ListedDatabase[] = [
    { datname: "postgres", comment: null },
    { datname: "foa_seed", comment: null },
    { datname: "foa_staging", comment: null },
    { datname: "foa_pr_1_0a1b2c3d", comment: "foa-preview pr=1" },
    { datname: "foa_pr_2_0a1b2c3d", comment: "foa-preview pr=2" },
  ];

  it("serves each preview from its own database", async () => {
    const pr1 = await createHarness();
    const pr2 = await createHarness();
    const member = await pr1.seed.member();
    await emitUserSignedUp(pr1, member.id);
    const { io, record } = fakeIo(
      { foa_pr_1_0a1b2c3d: pr1.db, foa_pr_2_0a1b2c3d: pr2.db },
      catalog
    );

    const worker = createWorker(PREVIEW_CONFIG, io);
    await worker.start();
    await worker.tick();

    expect(record.opened).toEqual([
      {
        url: "postgres://nonprod_worker:pw@10.112.12.11:5432/foa_pr_1_0a1b2c3d",
        connections: 2,
      },
      {
        url: "postgres://nonprod_worker:pw@10.112.12.11:5432/foa_pr_2_0a1b2c3d",
        connections: 2,
      },
    ]);
    const captured = await pr1.db.select().from(capturedMessage);
    expect(captured.map((m) => m.toAddress)).toEqual([member.email]);
    expect(await pr2.db.select().from(capturedMessage)).toEqual([]);
    for (const preview of [pr1, pr2]) {
      expect(await preview.db.select().from(workerHeartbeat)).toEqual([
        expect.objectContaining({
          worker: "worker-preview",
          environment: "preview",
          version: "9af49ce",
        }),
      ]);
    }
  });

  it("never starts pg-boss", async () => {
    const pr1 = await createHarness();
    const { io, record } = fakeIo({ foa_pr_1_0a1b2c3d: pr1.db }, [
      { datname: "foa_pr_1_0a1b2c3d", comment: "foa-preview pr=1" },
    ]);

    const worker = createWorker(PREVIEW_CONFIG, io);
    await worker.start();
    await worker.tick();
    await worker.stop();

    expect(record.bossStartedOn).toEqual([]);
    expect(record.ended).toEqual(["foa_pr_1_0a1b2c3d"]);
    expect(record.catalogEnded).toBe(1);
  });
});
