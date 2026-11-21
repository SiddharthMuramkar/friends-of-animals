import { describe, expect, it } from "vitest";

import { fieldCryptoFor } from "@/server/crypto/keys";
import type { OutboxDeps, ScheduleDefinition } from "@/server/outbox";
import { FakeClock } from "@/test/fakes/clock";
import { FakeEmail } from "@/test/fakes/email";
import { FakeSettings } from "@/test/fakes/settings";
import { FakeSms } from "@/test/fakes/sms";

import { registerSchedules, type ScheduleBoss } from "./schedules";

/** Records the pg-boss calls the worker makes; `existing` are stored crons. */
function recordingBoss(existing: string[] = []) {
  const calls: unknown[][] = [];
  const handlers = new Map<string, () => Promise<unknown>>();
  const boss: ScheduleBoss = {
    async getSchedules() {
      calls.push(["getSchedules"]);
      return existing.map((name) => ({ name, key: "" }));
    },
    async unschedule(name) {
      calls.push(["unschedule", name]);
    },
    async createQueue(name) {
      calls.push(["createQueue", name]);
    },
    async schedule(name, cron, data, options) {
      calls.push(["schedule", name, cron, data, options]);
    },
    async work(name, handler) {
      calls.push(["work", name]);
      handlers.set(name, () => handler([]));
      return `worker-${name}`;
    },
  };
  return { boss, calls, handlers };
}

const clock = new FakeClock();
const deps = {
  db: {} as OutboxDeps["db"],
  clock,
  email: new FakeEmail(clock),
  sms: new FakeSms(clock),
  settings: new FakeSettings(),
  cipher: fieldCryptoFor({ APP_ENV: "local" }).cipher,
} satisfies OutboxDeps;

function definition(
  name: string,
  overrides: Partial<ScheduleDefinition> = {}
): ScheduleDefinition {
  return {
    name,
    cron: "30 2 * * *",
    tz: "Asia/Kolkata",
    run: async () => {},
    ...overrides,
  };
}

describe("registerSchedules", () => {
  it("creates each schedule's queue, its cron and a worker for it", async () => {
    const { boss, calls } = recordingBoss();

    await registerSchedules(
      boss,
      [
        definition("retention.purge_captured_messages"),
        definition("reports.nightly", { cron: "0 0 * * *", tz: "UTC" }),
      ],
      deps
    );

    expect(calls).toEqual([
      ["getSchedules"],
      ["createQueue", "retention.purge_captured_messages"],
      [
        "schedule",
        "retention.purge_captured_messages",
        "30 2 * * *",
        null,
        { tz: "Asia/Kolkata" },
      ],
      ["work", "retention.purge_captured_messages"],
      ["createQueue", "reports.nightly"],
      ["schedule", "reports.nightly", "0 0 * * *", null, { tz: "UTC" }],
      ["work", "reports.nightly"],
    ]);
  });

  it("runs a schedule against the worker's database when its job comes", async () => {
    const { boss, handlers } = recordingBoss();
    const ran: OutboxDeps[] = [];

    await registerSchedules(
      boss,
      [definition("reports.nightly", { run: async (d) => void ran.push(d) })],
      deps
    );
    await handlers.get("reports.nightly")?.();

    expect(ran).toEqual([deps]);
  });

  it("removes a schedule the code no longer declares", async () => {
    const { boss, calls } = recordingBoss([
      "reports.nightly",
      "retention.old_purge",
    ]);

    await registerSchedules(boss, [definition("reports.nightly")], deps);

    expect(calls).toContainEqual(["unschedule", "retention.old_purge"]);
    expect(calls).not.toContainEqual(["unschedule", "reports.nightly"]);
  });

  it("registers nothing from an invalid registry", async () => {
    const { boss, calls } = recordingBoss(["reports.nightly"]);

    await expect(
      registerSchedules(
        boss,
        [definition("Reports Nightly"), definition("a"), definition("a")],
        deps
      )
    ).rejects.toThrow(/Reports Nightly.*\n.*a is declared more than once/s);
    expect(calls).toEqual([]);
  });

  it("only tidies up while no schedule is declared", async () => {
    const { boss, calls } = recordingBoss(["retention.old_purge"]);

    await registerSchedules(boss, [], deps);

    expect(calls).toEqual([
      ["getSchedules"],
      ["unschedule", "retention.old_purge"],
    ]);
  });
});
