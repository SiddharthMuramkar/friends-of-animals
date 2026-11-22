// Worker error tracking (#66). The real `@sentry/node` SDK starts with the
// worker's options and a transport that records each envelope instead of
// sending it, so what these tests read is what would leave for Sentry.
// No network.

import * as Sentry from "@sentry/node";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeErrorReporter } from "@/test/fakes/errors";

import {
  exitOnUncaught,
  startWorkerErrors,
  type WorkerSentrySdk,
} from "./errors";

const DSN = "https://abc123@o1.ingest.us.sentry.io/4507";
const decoder = new TextDecoder();

/** `@sentry/node`, but its events land in `envelopes`. */
function recordingSentry(envelopes: string[]): WorkerSentrySdk {
  return {
    ...Sentry,
    init: (options) =>
      Sentry.init({
        ...options,
        transport: (transportOptions) =>
          Sentry.createTransport(transportOptions, async (request) => {
            envelopes.push(
              typeof request.body === "string"
                ? request.body
                : decoder.decode(request.body)
            );
            return { statusCode: 200 };
          }),
      }),
  };
}

/** The error events in the envelopes, as JSON. */
function sentEvents(envelopes: string[]) {
  return envelopes.flatMap((envelope) => {
    const [, itemHeader, item] = envelope.split("\n");
    return itemHeader?.includes('"type":"event"') && item
      ? [JSON.parse(item)]
      : [];
  });
}

const log = vi.fn();

afterEach(async () => {
  await Sentry.close(2000);
  log.mockReset();
  vi.unstubAllEnvs();
});

describe("startWorkerErrors", () => {
  it("sends nothing and never loads the SDK without SENTRY_DSN", async () => {
    const loadSdk = vi.fn(async () => Sentry);

    const errors = await startWorkerErrors({
      dsn: undefined,
      appEnv: "staging",
      loadSdk,
      log,
    });
    errors.tenantFailed(new Error("relay failed"), { tenant: "foa_staging" });

    expect(loadSdk).not.toHaveBeenCalled();
    await expect(errors.flush()).resolves.toBe(true);
  });

  it("sends a failed tick once, scrubbed, with APP_ENV and the database as a tag", async () => {
    const envelopes: string[] = [];
    const errors = await startWorkerErrors({
      dsn: DSN,
      appEnv: "preview",
      version: "4f2a9c1",
      loadSdk: async () => recordingSentry(envelopes),
      log,
    });

    // Made at run time: the SDK sends the source line of each stack frame,
    // so a literal address in this file would leave anyway.
    const email = `asha.${randomBytes(6).toString("hex")}@example.test`;
    errors.tenantFailed(new Error(`Welcome email to ${email} bounced`), {
      tenant: "foa_pr_142_3fa9c2d1",
    });
    await expect(errors.flush()).resolves.toBe(true);

    const events = sentEvents(envelopes);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.environment).toBe("preview");
    expect(event.release).toBe("4f2a9c1");
    expect(event.tags).toMatchObject({
      where: "worker.tick",
      tenant: "foa_pr_142_3fa9c2d1",
    });
    expect(event.exception.values[0].value).toMatch(/^Welcome email to /);
    expect(envelopes.join("\n")).not.toContain(email);
  });

  it.each(["dev", "unknown"])(
    "names no release for a worker built as %s, whatever commit its host names",
    async (version) => {
      // GitHub Actions sets this, and the SDK names it as the release when
      // it is given none. Made at run time, as the address above is.
      const hostCommit = randomBytes(20).toString("hex");
      vi.stubEnv("GITHUB_SHA", hostCommit);
      const envelopes: string[] = [];
      const errors = await startWorkerErrors({
        dsn: DSN,
        appEnv: "local",
        version,
        loadSdk: async () => recordingSentry(envelopes),
        log,
      });

      errors.tenantFailed(new Error("relay failed"), { tenant: "foa" });
      await errors.flush();

      const [event] = sentEvents(envelopes);
      expect(event.environment).toBe("local");
      expect(event.release).toBeUndefined();
      expect(envelopes.join("\n")).not.toContain(hostCommit);
    }
  );

  it("leaves uncaught errors to the worker: the SDK adds no process handlers", async () => {
    const before = {
      exception: process.listenerCount("uncaughtException"),
      rejection: process.listenerCount("unhandledRejection"),
    };

    await startWorkerErrors({
      dsn: DSN,
      appEnv: "staging",
      loadSdk: async () => recordingSentry([]),
      log,
    });

    expect(process.listenerCount("uncaughtException")).toBe(before.exception);
    expect(process.listenerCount("unhandledRejection")).toBe(before.rejection);
  });

  it("waits at most 2 s for queued events when flushing before exit", async () => {
    const flush = vi.fn(async () => true);
    const errors = await startWorkerErrors({
      dsn: DSN,
      appEnv: "production",
      loadSdk: async () => ({
        init: () => undefined,
        captureException: () => "event-id",
        flush,
      }),
      log,
    });

    await errors.flush();

    expect(flush).toHaveBeenCalledWith(2000);
  });

  it("starts without error tracking, and says so, when the SDK fails to load", async () => {
    const errors = await startWorkerErrors({
      dsn: DSN,
      appEnv: "staging",
      loadSdk: async () => {
        throw new Error("Cannot find module '@sentry/node'");
      },
      log,
    });

    errors.tenantFailed(new Error("relay failed"), { tenant: "foa_staging" });

    await expect(errors.flush()).resolves.toBe(true);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", event: "errors.sdk_failed" })
    );
  });

  it("refuses to start on a SENTRY_DSN that is set but malformed", async () => {
    await expect(
      startWorkerErrors({
        dsn: "not-a-dsn",
        appEnv: "staging",
        loadSdk: async () => Sentry,
        log,
      })
    ).rejects.toThrow(/not a valid Sentry DSN/);
  });
});

describe("exitOnUncaught", () => {
  it.each([
    ["uncaughtException", "worker.uncaughtException"],
    ["unhandledRejection", "worker.unhandledRejection"],
  ])("reports an %s, flushes, then exits 1", async (event, where) => {
    const reporter = new FakeErrorReporter();
    let flushed!: (sent: boolean) => void;
    const flush = vi
      .spyOn(reporter, "flush")
      .mockReturnValue(new Promise((resolve) => (flushed = resolve)));
    const proc = new EventEmitter();
    const exit = vi.fn();
    exitOnUncaught(reporter, { process: proc, exit, log });
    const error = new Error("tick lost track of a promise");

    proc.emit(event, error);

    expect(reporter.reported).toEqual([
      expect.objectContaining({ error, tags: { where } }),
    ]);
    expect(flush).toHaveBeenCalledWith(2000);
    expect(exit).not.toHaveBeenCalled();
    flushed(true);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", error: "Error" })
    );
  });

  it("flushes and exits once when a second error arrives while flushing", async () => {
    const reporter = new FakeErrorReporter();
    const flush = vi
      .spyOn(reporter, "flush")
      .mockReturnValue(new Promise(() => {}));
    const proc = new EventEmitter();
    const exit = vi.fn();
    exitOnUncaught(reporter, { process: proc, exit, log });

    proc.emit("uncaughtException", new Error("first"));
    proc.emit("unhandledRejection", new Error("second"));

    expect(reporter.reported).toHaveLength(2);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
