import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import type { AppDb } from "@/server/db/app-db";
import {
  capturedMessage,
  fileAsset,
  fileDerivative,
  fileProcessing,
  outbox,
  workerHeartbeat,
} from "@/server/db/schema";
import { OffsiteCopyNotConfiguredError } from "@/server/modules/offsite-copy/errors";
import { drainUntilIdle } from "@/server/outbox";
import { emitUserSignedUp } from "@/server/outbox/testing";
import type { Clock } from "@/server/ports/clock";
import type { ErrorReporter } from "@/server/ports/errors";
import type { MalwareScanner } from "@/server/ports/malware-scanner";
import type { MediaProcessor } from "@/server/ports/media";
import type { ObjectStorage } from "@/server/ports/storage";
import { createTestDb } from "@/test/db";
import { FakeClock } from "@/test/fakes/clock";
import { FakeErrorReporter } from "@/test/fakes/errors";
import { FakeMalwareScanner } from "@/test/fakes/malware-scanner";
import { FakeMediaProcessor } from "@/test/fakes/media";
import { FakeStorage } from "@/test/fakes/storage";
import { createHarness, type Harness } from "@/test/harness";
import { readMediaFixture } from "@/test/media-fixtures";

import type { WorkerConfig } from "./config";
import type { WorkerLogEntry } from "./log";
import type { ListedDatabase } from "./preview-databases";
import type { ScheduleBossJob } from "./schedules";
import { createWorker, type WorkerIo } from "./worker";

const DB_URL = "postgres://foa_worker:pw@10.112.12.10:5432/foa";
const ADMIN_URL = "postgres://nonprod_worker:pw@10.112.12.11:5432/postgres";

const COMMON = {
  pollMs: 5_000,
  discoveryMs: 60_000,
  heartbeatFile: "/tmp/foa-worker-heartbeat",
  passwordFile: undefined,
  sentryDsn: undefined,
  r2: undefined,
  clamd: { CLAMD_PORT: 3310 },
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
    queue: { name: "default" },
  };
}

/** worker-media: production's media queue, 90 s a job. */
const MEDIA_CONFIG: WorkerConfig = {
  ...singleConfig("production"),
  identity: {
    worker: "worker-media",
    environment: "production",
    version: "dev",
  },
  queue: { name: "media", timeoutSeconds: 90 },
};

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
  queue: { name: "default" },
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
  catalog: ListedDatabase[] = [],
  ports: {
    clock?: Clock;
    storage?: ObjectStorage;
    scanner?: MalwareScanner;
    media?: MediaProcessor;
    errors?: ErrorReporter;
  } = {}
) {
  const clock = ports.clock ?? new FakeClock();
  const record = {
    opened: [] as { url: string; connections: number }[],
    ended: [] as string[],
    bossStartedOn: [] as string[],
    bossCalls: [] as string[],
    bossHandlers: new Map<
      string,
      (jobs: ScheduleBossJob[]) => Promise<unknown>
    >(),
    bossStopped: 0,
    catalogEnded: 0,
    beats: [] as Date[],
    log: [] as WorkerLogEntry[],
    errors: [] as { error: unknown; tenant: string }[],
    mediaMade: [] as { timeoutSeconds: number }[],
  };
  const io: WorkerIo = {
    clock,
    storage: ports.storage ?? new FakeStorage(clock),
    scanner: ports.scanner ?? new FakeMalwareScanner(),
    errors: ports.errors ?? new FakeErrorReporter(),
    async makeMediaProcessor(options) {
      record.mediaMade.push(options);
      return ports.media ?? new FakeMediaProcessor();
    },
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
        work: async (name, _options, handler) => {
          record.bossHandlers.set(name, handler);
          return "";
        },
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
  it("scans an upload in its database with its storage and scanner", async () => {
    const h = await createHarness();
    const owner = await h.signIn(await h.seed.member());
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const requested = await h.as(owner).requestUpload({
      purpose: "test_upload",
      contentType: "image/png",
      sizeBytes: png.length,
    });
    if (!requested.ok) throw new Error(`refused: ${requested.error}`);
    await h.storage.put(requested.uploadUrl, png, requested.headers);
    await h.as(owner).completeUpload({ fileId: requested.fileId });
    const { io } = fakeIo({ foa: h.db }, [], {
      clock: h.clock,
      storage: h.storage,
      scanner: h.scanner,
    });

    const worker = createWorker(singleConfig("local"), io);
    await worker.start();
    await worker.tick();

    expect(h.scanner.scans).toBe(1);
    expect(
      await h.db
        .select({ status: fileAsset.status })
        .from(fileAsset)
        .where(eq(fileAsset.id, requested.fileId))
    ).toEqual([{ status: "clean" }]);
  });

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

  it("reports a scheduled run's final failure through its error reporter", async () => {
    vi.stubEnv("APP_ENV", "production");
    try {
      const h = await createHarness();
      const errors = new FakeErrorReporter();
      const { io, record } = fakeIo({ foa: h.db }, [], { errors });

      const worker = createWorker(singleConfig("production"), io);
      await worker.start();
      // The off-site copy has no buckets set here, so its run fails.
      const run = record.bossHandlers.get("offsite_copy");
      await expect(run?.([{ retryCount: 3, retryLimit: 3 }])).rejects.toThrow(
        OffsiteCopyNotConfiguredError
      );
      await worker.stop();

      expect(errors.reported).toEqual([
        expect.objectContaining({
          type: "OffsiteCopyNotConfiguredError",
          tags: expect.objectContaining({ job: "offsite_copy" }),
        }),
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
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

const JPEG = readMediaFixture("gpsJpeg");

/**
 * `count` JPEGs one member uploads, scanned clean by the default queue (as
 * the VPS worker would), so each has a media job waiting.
 */
async function cleanImages(h: Harness, count = 1): Promise<string[]> {
  const owner = await h.signIn(await h.seed.member());
  const ids: string[] = [];
  for (let n = 0; n < count; n += 1) {
    const requested = await h.as(owner).requestUpload({
      purpose: "test_upload",
      contentType: "image/jpeg",
      sizeBytes: JPEG.length,
    });
    if (!requested.ok) throw new Error(`refused: ${requested.error}`);
    const stored = await h.storage.put(
      requested.uploadUrl,
      JPEG,
      requested.headers
    );
    if (!stored.ok) throw new Error(`not stored: ${stored.error}`);
    const completed = await h
      .as(owner)
      .completeUpload({ fileId: requested.fileId });
    if (!completed.ok) throw new Error(`not completed: ${completed.error}`);
    ids.push(requested.fileId);
  }
  await drainUntilIdle(h.deps);
  return ids;
}

describe("worker-media", () => {
  it("makes each clean image's derivatives, and runs nothing else", async () => {
    const h = await createHarness();
    const [fileId] = await cleanImages(h);
    const member = await h.seed.member();
    await emitUserSignedUp(h, member.id);
    const { io, record } = fakeIo({ foa: h.db }, [], {
      storage: h.storage,
      media: h.media,
    });

    const worker = createWorker(MEDIA_CONFIG, io);
    await worker.start();
    await worker.tick();
    await worker.stop();

    expect(
      await h.db
        .select({
          file: fileProcessing.fileAssetId,
          status: fileProcessing.status,
        })
        .from(fileProcessing)
    ).toEqual([{ file: fileId, status: "done" }]);
    expect(
      await h.db
        .select({ kind: fileDerivative.kind })
        .from(fileDerivative)
        .orderBy(fileDerivative.kind)
    ).toEqual([{ kind: "display_1600" }, { kind: "thumb_320" }]);
    expect(record.mediaMade).toEqual([{ timeoutSeconds: 90 }]);
    // The welcome email is the default workers' to send.
    expect(
      await h.db
        .select({ status: outbox.status })
        .from(outbox)
        .where(eq(outbox.handler, "notifications.send_welcome_email"))
    ).toEqual([{ status: "pending" }]);
    expect(await h.db.select().from(capturedMessage)).toEqual([]);
  });

  it("runs no schedules and writes no heartbeat row, but stays healthy", async () => {
    const h = await createHarness();
    const { io, record } = fakeIo({ foa: h.db });

    const worker = createWorker(MEDIA_CONFIG, io);
    await worker.start();
    await worker.tick();
    await worker.stop();

    // Schedules are the default worker's, on pg-boss.
    expect(record.bossStartedOn).toEqual([]);
    // /api/health/worker judges production's default worker by its row; a
    // media worker's row would hide a stalled worker-prod.
    expect(await h.db.select().from(workerHeartbeat)).toEqual([]);
    // The container's health check reads the heartbeat file.
    expect(record.beats).toEqual([io.clock.now()]);
  });

  it("makes one image per poll, so it beats between images", async () => {
    // One job may take up to its deadline; a poll that drained a backlog
    // would go minutes without touching the heartbeat file the container's
    // health check reads (120 s).
    const h = await createHarness();
    await cleanImages(h, 2);
    const { io, record } = fakeIo({ foa: h.db }, [], {
      storage: h.storage,
      media: h.media,
    });
    const statuses = async () =>
      (
        await h.db
          .select({ status: fileProcessing.status })
          .from(fileProcessing)
      )
        .map(({ status }) => status)
        .sort();

    const worker = createWorker(MEDIA_CONFIG, io);
    await worker.start();
    await worker.tick();
    expect(await statuses()).toEqual(["done", "queued"]);
    expect(record.beats).toHaveLength(1);

    await worker.tick();
    expect(await statuses()).toEqual(["done", "done"]);
    expect(record.beats).toHaveLength(2);
    await worker.stop();
  });
});
