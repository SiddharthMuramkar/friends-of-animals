import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createFieldCipher } from "@/server/crypto/field-cipher";
import { databaseSettings } from "@/server/modules/settings";
import {
  SCHEDULES,
  type ScheduleDefinition,
  type ScheduleDeps,
  type ScheduleJob,
} from "@/server/outbox";
import { unconfiguredMedia } from "@/server/ports/media";
import { unconfiguredPaymentGateway } from "@/server/ports/payment-gateway";
import { FakeClock } from "@/test/fakes/clock";
import { FakeEmail } from "@/test/fakes/email";
import { FakeErrorReporter } from "@/test/fakes/errors";
import { FakeMalwareScanner } from "@/test/fakes/malware-scanner";
import { FakeSms } from "@/test/fakes/sms";
import { FakeStorage } from "@/test/fakes/storage";

import {
  registerSchedules,
  type ScheduleBoss,
  type ScheduleBossJob,
} from "./schedules";

/** Records the pg-boss calls the worker makes; `existing` are stored crons. */
function recordingBoss(existing: string[] = []) {
  const calls: unknown[][] = [];
  const handlers = new Map<
    string,
    (jobs: ScheduleBossJob[]) => Promise<unknown>
  >();
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
    async work(name, options, handler) {
      calls.push(["work", name, options]);
      handlers.set(name, handler);
      return `worker-${name}`;
    },
  };
  return { boss, calls, handlers };
}

const clock = new FakeClock();
const db = {} as ScheduleDeps["db"];
const deps = {
  appEnv: "local",
  db,
  clock,
  email: new FakeEmail(clock),
  sms: new FakeSms(clock),
  settings: databaseSettings(db),
  cipher: createFieldCipher({
    primary: 1,
    keys: new Map([[1, randomBytes(32)]]),
  }),
  storage: new FakeStorage(clock),
  files: { bucket: "local", keyPrefix: "local/" },
  scanner: new FakeMalwareScanner(),
  media: unconfiguredMedia,
  payments: unconfiguredPaymentGateway,
  auth: {},
  errors: new FakeErrorReporter(),
} satisfies ScheduleDeps;

/** What `work` asks pg-boss for: each job's retry count and limit. */
const WITH_METADATA = { includeMetadata: true };

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
      ["work", "retention.purge_captured_messages", WITH_METADATA],
      ["createQueue", "reports.nightly"],
      ["schedule", "reports.nightly", "0 0 * * *", null, { tz: "UTC" }],
      ["work", "reports.nightly", WITH_METADATA],
    ]);
  });

  it("runs a schedule against the worker's database when its job comes", async () => {
    const { boss, handlers } = recordingBoss();
    const ran: ScheduleDeps[] = [];

    await registerSchedules(
      boss,
      [definition("reports.nightly", { run: async (d) => void ran.push(d) })],
      deps
    );
    await handlers.get("reports.nightly")?.([]);

    expect(ran).toEqual([deps]);
  });

  it("passes a schedule's retries and time limit on with its cron", async () => {
    const { boss, calls } = recordingBoss();

    await registerSchedules(
      boss,
      [
        definition("reports.nightly", {
          retryLimit: 3,
          retryDelay: 900,
          retryBackoff: true,
          expireInSeconds: 10800,
        }),
      ],
      deps
    );

    expect(calls).toContainEqual([
      "schedule",
      "reports.nightly",
      "30 2 * * *",
      null,
      {
        tz: "Asia/Kolkata",
        retryLimit: 3,
        retryDelay: 900,
        retryBackoff: true,
        expireInSeconds: 10800,
      },
    ]);
  });

  it("tells a run whether pg-boss will try it again", async () => {
    const { boss, handlers } = recordingBoss();
    const jobs: (ScheduleJob | undefined)[] = [];

    await registerSchedules(
      boss,
      [
        definition("reports.nightly", {
          retryLimit: 3,
          run: async (_deps, job) => void jobs.push(job),
        }),
      ],
      deps
    );
    const handler = handlers.get("reports.nightly");
    await handler?.([{ retryCount: 0, retryLimit: 3 }]);
    await handler?.([{ retryCount: 2, retryLimit: 3 }]);
    await handler?.([{ retryCount: 3, retryLimit: 3 }]);

    expect(jobs).toEqual([
      { finalAttempt: false },
      { finalAttempt: false },
      { finalAttempt: true },
    ]);
  });

  it("gives pg-boss the off-site copy's retries (#68)", async () => {
    const { boss, calls } = recordingBoss();

    await registerSchedules(boss, SCHEDULES, deps);

    expect(calls).toContainEqual([
      "schedule",
      "offsite_copy",
      "30 1 * * *",
      null,
      {
        tz: "Asia/Kolkata",
        retryLimit: 3,
        retryDelay: 900,
        retryBackoff: true,
        expireInSeconds: 10800,
      },
    ]);
    expect(calls).toContainEqual(["work", "offsite_copy", WITH_METADATA]);
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
