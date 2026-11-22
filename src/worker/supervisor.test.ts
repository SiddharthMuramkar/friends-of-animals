import { describe, expect, it } from "vitest";

import type { DrainReport } from "@/server/outbox";
import { FakeClock } from "@/test/fakes/clock";

import type { WorkerLogEntry } from "./log";
import { createSupervisor } from "./supervisor";
import type { Tenant } from "./tenant";

const IDLE: DrainReport = { dispatched: 0, retried: 0, failed: 0, skipped: 0 };
const DISCOVERY_MS = 60_000;

const gone = (database: string) =>
  Object.assign(new Error(`database "${database}" does not exist`), {
    code: "3D000",
  });
const sessionKilled = () =>
  Object.assign(
    new Error("terminating connection due to administrator command"),
    { code: "57P01" }
  );

/**
 * A world of fake tenants. `listed` is what the next discovery returns (or
 * throws); `failing` makes a database's ticks reject with that error.
 */
function world({ everyTenantMustTick = false } = {}) {
  const clock = new FakeClock();
  const state = {
    listed: [] as readonly string[] | Error,
    failing: new Map<string, unknown>(),
    listings: 0,
    started: [] as string[],
    ticked: [] as string[],
    closed: [] as string[],
    beats: [] as Date[],
    log: [] as WorkerLogEntry[],
    errors: [] as { error: unknown; tenant: string }[],
    startFails: undefined as Error | undefined,
  };
  const startTenant = (database: string): Tenant => {
    if (state.startFails) throw state.startFails;
    state.started.push(database);
    return {
      database,
      async tick() {
        state.ticked.push(database);
        if (state.failing.has(database)) throw state.failing.get(database);
        return IDLE;
      },
      async close() {
        state.closed.push(database);
      },
    };
  };
  const supervisor = createSupervisor({
    clock,
    discoveryIntervalMs: DISCOVERY_MS,
    everyTenantMustTick,
    async listDatabases() {
      state.listings += 1;
      if (state.listed instanceof Error) throw state.listed;
      return state.listed;
    },
    startTenant: async (database) => startTenant(database),
    async beat(at) {
      state.beats.push(at);
    },
    log: (entry) => state.log.push(entry),
    onError: (error, { tenant }) => state.errors.push({ error, tenant }),
  });
  const reset = () => {
    state.ticked = [];
    state.beats = [];
  };
  return { clock, state, supervisor, reset };
}

describe("the supervisor", () => {
  it("reports a failing tick once until it recovers, and never a dropped database", async () => {
    const { state, supervisor } = world();
    state.listed = ["foa_pr_1_0a1b2c3d", "foa_pr_2_0a1b2c3d"];
    const first = new Error("relay failed");
    state.failing.set("foa_pr_1_0a1b2c3d", first);
    await supervisor.tick();
    await supervisor.tick();

    state.failing.delete("foa_pr_1_0a1b2c3d");
    await supervisor.tick();
    const second = new Error("relay failed again");
    state.failing.set("foa_pr_1_0a1b2c3d", second);
    state.failing.set("foa_pr_2_0a1b2c3d", gone("foa_pr_2_0a1b2c3d"));
    await supervisor.tick();
    await supervisor.tick();

    expect(state.errors).toEqual([
      { error: first, tenant: "foa_pr_1_0a1b2c3d" },
      { error: second, tenant: "foa_pr_1_0a1b2c3d" },
    ]);
  });

  it("serves every listed database from its first tick", async () => {
    const { state, supervisor } = world();
    state.listed = ["foa_pr_1_0a1b2c3d", "foa_pr_2_0a1b2c3d"];

    await supervisor.tick();

    expect(supervisor.serving()).toEqual([
      "foa_pr_1_0a1b2c3d",
      "foa_pr_2_0a1b2c3d",
    ]);
    expect(state.ticked.sort()).toEqual(state.started.sort());
  });

  it("attaches a new preview's database at the next discovery", async () => {
    const { clock, state, supervisor, reset } = world();
    state.listed = ["foa_pr_1_0a1b2c3d"];
    await supervisor.tick();

    state.listed = ["foa_pr_1_0a1b2c3d", "foa_pr_2_0a1b2c3d"];
    clock.advance(DISCOVERY_MS);
    reset();
    await supervisor.tick();

    expect(state.started).toEqual(["foa_pr_1_0a1b2c3d", "foa_pr_2_0a1b2c3d"]);
    expect(state.ticked.sort()).toEqual([
      "foa_pr_1_0a1b2c3d",
      "foa_pr_2_0a1b2c3d",
    ]);
    expect(state.log).toContainEqual(
      expect.objectContaining({
        event: "tenant.attached",
        database: "foa_pr_2_0a1b2c3d",
      })
    );
  });

  it("lists databases again only once the discovery interval has passed", async () => {
    const { clock, state, supervisor } = world();
    state.listed = ["foa_pr_1_0a1b2c3d"];
    await supervisor.tick();

    clock.advance(DISCOVERY_MS - 1);
    await supervisor.tick();
    expect(state.listings).toBe(1);

    clock.advance(1);
    await supervisor.tick();
    expect(state.listings).toBe(2);
  });

  it("stops serving a database once it is no longer listed", async () => {
    const { clock, state, supervisor, reset } = world();
    state.listed = ["foa_pr_1_0a1b2c3d", "foa_pr_2_0a1b2c3d"];
    await supervisor.tick();

    state.listed = ["foa_pr_1_0a1b2c3d"];
    clock.advance(DISCOVERY_MS);
    reset();
    await supervisor.tick();

    expect(state.closed).toEqual(["foa_pr_2_0a1b2c3d"]);
    expect(state.ticked).toEqual(["foa_pr_1_0a1b2c3d"]);
    expect(supervisor.serving()).toEqual(["foa_pr_1_0a1b2c3d"]);
  });

  it("stops serving a dropped database before the next discovery", async () => {
    const { clock, state, supervisor, reset } = world();
    state.listed = ["foa_pr_1_0a1b2c3d", "foa_pr_2_0a1b2c3d"];
    await supervisor.tick();

    state.failing.set("foa_pr_2_0a1b2c3d", gone("foa_pr_2_0a1b2c3d"));
    clock.advance({ seconds: 5 });
    await supervisor.tick();

    expect(state.listings).toBe(1);
    expect(state.closed).toEqual(["foa_pr_2_0a1b2c3d"]);
    expect(supervisor.serving()).toEqual(["foa_pr_1_0a1b2c3d"]);

    clock.advance({ seconds: 5 });
    reset();
    await supervisor.tick();
    expect(state.ticked).toEqual(["foa_pr_1_0a1b2c3d"]);
  });

  it("keeps serving through other failures and logs each one once", async () => {
    const { clock, state, supervisor } = world();
    state.listed = ["foa_pr_1_0a1b2c3d"];
    state.failing.set("foa_pr_1_0a1b2c3d", sessionKilled());

    await supervisor.tick();
    clock.advance({ seconds: 5 });
    await supervisor.tick();

    expect(supervisor.serving()).toEqual(["foa_pr_1_0a1b2c3d"]);
    expect(state.closed).toEqual([]);
    const failures = state.log.filter((e) => e.event === "tenant.tick_failed");
    expect(failures).toEqual([
      expect.objectContaining({
        level: "error",
        database: "foa_pr_1_0a1b2c3d",
        error: expect.stringContaining("57P01"),
      }),
    ]);
  });

  it("logs a tenant's failure again after it has recovered", async () => {
    const { clock, state, supervisor } = world();
    state.listed = ["foa_pr_1_0a1b2c3d"];
    state.failing.set("foa_pr_1_0a1b2c3d", sessionKilled());
    await supervisor.tick();

    state.failing.clear();
    clock.advance({ seconds: 5 });
    await supervisor.tick();
    state.failing.set("foa_pr_1_0a1b2c3d", sessionKilled());
    clock.advance({ seconds: 5 });
    await supervisor.tick();

    const failures = state.log.filter((e) => e.event === "tenant.tick_failed");
    expect(failures).toHaveLength(2);
  });

  it("beats while discovery works, whatever one preview does", async () => {
    const { clock, state, supervisor } = world();
    state.listed = ["foa_pr_1_0a1b2c3d", "foa_pr_2_0a1b2c3d"];
    state.failing.set("foa_pr_2_0a1b2c3d", sessionKilled());

    await supervisor.tick();

    expect(state.beats).toEqual([clock.now()]);
  });

  it("beats with no preview to serve", async () => {
    const { clock, state, supervisor } = world();
    state.listed = [];

    await supervisor.tick();

    expect(state.beats).toEqual([clock.now()]);
  });

  it("keeps its tenants and stops beating while discovery fails", async () => {
    const { clock, state, supervisor, reset } = world();
    state.listed = ["foa_pr_1_0a1b2c3d"];
    await supervisor.tick();

    state.listed = new Error("connect ECONNREFUSED 10.112.12.11:5432");
    clock.advance(DISCOVERY_MS);
    reset();
    await supervisor.tick();

    expect(supervisor.serving()).toEqual(["foa_pr_1_0a1b2c3d"]);
    expect(state.ticked).toEqual(["foa_pr_1_0a1b2c3d"]);
    expect(state.beats).toEqual([]);
    expect(state.log).toContainEqual(
      expect.objectContaining({ level: "error", event: "discovery.failed" })
    );

    clock.advance({ seconds: 5 });
    state.listed = ["foa_pr_1_0a1b2c3d"];
    await supervisor.tick();
    expect(state.beats).toEqual([clock.now()]);
  });

  it("stops beating while its one database fails, in single mode", async () => {
    const { clock, state, supervisor, reset } = world({
      everyTenantMustTick: true,
    });
    state.listed = ["foa_staging"];
    await supervisor.tick();
    expect(state.beats).toEqual([clock.now()]);

    state.failing.set("foa_staging", sessionKilled());
    clock.advance({ seconds: 5 });
    reset();
    await supervisor.tick();

    expect(state.beats).toEqual([]);
    expect(supervisor.serving()).toEqual(["foa_staging"]);
  });

  it("doesn't beat in single mode until its database has a tenant", async () => {
    const { state, supervisor } = world({ everyTenantMustTick: true });
    state.listed = ["foa_staging"];
    state.startFails = new Error("getaddrinfo EAI_AGAIN pg-nonprod");

    await supervisor.tick();

    expect(supervisor.serving()).toEqual([]);
    expect(state.beats).toEqual([]);
    expect(state.log).toContainEqual(
      expect.objectContaining({
        event: "tenant.attach_failed",
        database: "foa_staging",
      })
    );
  });

  it("closes every tenant when it stops", async () => {
    const { state, supervisor } = world();
    state.listed = ["foa_pr_1_0a1b2c3d", "foa_pr_2_0a1b2c3d"];
    await supervisor.tick();

    await supervisor.stop();

    expect(state.closed.sort()).toEqual([
      "foa_pr_1_0a1b2c3d",
      "foa_pr_2_0a1b2c3d",
    ]);
    expect(supervisor.serving()).toEqual([]);
  });
});
