import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import type { E164Phone } from "@/lib/phone";
import { fieldCryptoFor } from "@/server/crypto/keys";
import type { AppDb } from "@/server/db/app-db";
import {
  capturedMessage,
  fileAsset,
  inboxItem,
  messageRoute,
  messageTemplate,
  outbox,
  user,
  workerHeartbeat,
} from "@/server/db/schema";
import { storedPhone } from "@/server/identity/stored-phone";
import { OffsiteCopyNotConfiguredError } from "@/server/modules/offsite-copy/errors";
import { emitUserSignedUp } from "@/server/outbox/testing";
import { createTestDb } from "@/test/db";
import { FakeClock } from "@/test/fakes/clock";
import { FakeErrorReporter } from "@/test/fakes/errors";
import { FakeMalwareScanner } from "@/test/fakes/malware-scanner";
import { FakeStorage } from "@/test/fakes/storage";
import { createHarness, type Harness } from "@/test/harness";

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
 * `catalog` is what pg-nonprod lists; `overrides` replace any of the rest.
 * Records what the worker opened.
 */
function fakeIo(
  databases: Record<string, AppDb>,
  catalog: ListedDatabase[] = [],
  overrides: Partial<WorkerIo> = {}
) {
  const clock = new FakeClock();
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
  };
  const io: WorkerIo = {
    clock,
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
    storage: new FakeStorage(clock),
    scanner: new FakeMalwareScanner(),
    errors: new FakeErrorReporter(),
    ...overrides,
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

const PHONE = "+919876543210" as E164Phone;

/**
 * SMS switched on in the database's settings, a welcome message by email,
 * SMS and in-app with its SMS registered, and a member with a verified
 * phone stored under the public development keys.
 */
async function welcomeBySms(h: Harness) {
  await h.settings.set("sms.enabled", true);
  await h.db
    .update(messageRoute)
    .set({ channels: ["email", "sms", "in_app"] })
    .where(eq(messageRoute.templateKey, "identity.welcome"));
  await h.db
    .update(messageTemplate)
    .set({ dltTemplateId: "1107170000000000001" })
    .where(
      and(
        eq(messageTemplate.key, "identity.welcome"),
        eq(messageTemplate.channel, "sms")
      )
    );
  const member = await h.seed.member();
  await h.db
    .update(user)
    .set({
      ...storedPhone(fieldCryptoFor({ APP_ENV: "local" }), PHONE),
      phoneVerified: true,
    })
    .where(eq(user.id, member.id));
  await emitUserSignedUp(h, member.id);
  return member;
}

describe("a worker's messages by SMS", () => {
  it("texts a member while the database's settings switch SMS on", async () => {
    const h = await createHarness();
    const member = await welcomeBySms(h);
    const { io } = fakeIo({ foa: h.db });

    const worker = createWorker(singleConfig("local"), io);
    await worker.start();
    await worker.tick();

    const captured = await h.db.select().from(capturedMessage);
    expect(captured.map((m) => [m.channel, m.toAddress]).sort()).toEqual([
      ["email", member.email],
      ["sms", PHONE],
    ]);
  });

  it("sends the email and the inbox item without field keys, and keeps retrying the SMS", async () => {
    const h = await createHarness();
    const member = await welcomeBySms(h);
    const { io } = fakeIo({ foa: h.db });

    const worker = createWorker(singleConfig("staging"), io);
    await worker.start();
    await worker.tick();

    const captured = await h.db.select().from(capturedMessage);
    expect(captured.map((m) => [m.channel, m.toAddress])).toEqual([
      ["email", member.email],
    ]);
    expect(
      await h.db.select().from(inboxItem).where(eq(inboxItem.userId, member.id))
    ).toHaveLength(1);
    const [delivery] = await h.db.select().from(outbox);
    expect(delivery).toMatchObject({ status: "pending", attempts: 1 });
    expect(delivery?.lastError).toContain("FIELD_ENCRYPTION_KEYS");
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
