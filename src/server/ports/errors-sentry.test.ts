import { describe, expect, it } from "vitest";

import { errorTracking, sentryOptions } from "@/lib/observability/config";
import { exceptionOf } from "@/test/fakes/errors";

import { hashUserId } from "./errors";
import type { SentEvent } from "./errors.contract";
import { errorReporterContract } from "./errors.contract";
import { sentryErrorReporter, type SentrySdk } from "./errors-sentry";

type SentryEvent = {
  exception?: { values?: { type?: string; value?: string }[] };
  environment?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  user?: { id: string };
};

/**
 * Stands in for `@sentry/nextjs` after `init(sentryOptions(...))`: builds
 * the event the SDK would build from `captureException` and runs it
 * through the same `beforeSend`, recording what would leave.
 */
function recordingSdk() {
  const tracking = errorTracking({
    dsn: "https://abc123@o1.ingest.us.sentry.io/4507",
    appEnv: "staging",
  });
  if (!tracking.enabled) throw new Error("tracking should be on");
  const options = sentryOptions(tracking, { hashUserId });
  const events: SentryEvent[] = [];
  const sdk: SentrySdk = {
    captureException(error, hint) {
      const event: SentryEvent = {
        exception: { values: [exceptionOf(error)] },
        environment: options.environment,
        ...(hint?.tags ? { tags: hint.tags } : {}),
        ...(hint?.extra ? { extra: hint.extra } : {}),
        ...(hint?.user ? { user: hint.user } : {}),
      };
      events.push(options.beforeSend(event));
      return `event-${events.length}`;
    },
    flush: async () => true,
  };
  return { sdk, events };
}

function asSent(event: SentryEvent): SentEvent {
  const [exception] = event.exception?.values ?? [];
  return {
    type: exception?.type ?? "",
    message: exception?.value ?? "",
    tags: event.tags ?? {},
    extra: event.extra ?? {},
    ...(event.user ? { user: event.user } : {}),
  };
}

errorReporterContract("sentryErrorReporter", async () => {
  const { sdk, events } = recordingSdk();
  return { reporter: sentryErrorReporter(sdk), sent: () => events.map(asSent) };
});

describe("sentryErrorReporter", () => {
  it("tags every event with the environment it was started with", () => {
    const { sdk, events } = recordingSdk();
    sentryErrorReporter(sdk).report(new Error("boom"));

    expect(events[0]?.environment).toBe("staging");
  });

  it("never throws, even when the SDK does", () => {
    const sdk: SentrySdk = {
      captureException: () => {
        throw new Error("SDK broke");
      },
      flush: async () => true,
    };

    expect(() =>
      sentryErrorReporter(sdk).report(new Error("boom"))
    ).not.toThrow();
  });

  it("says false when the SDK could not send everything in time", async () => {
    const late: SentrySdk = {
      captureException: () => "id",
      flush: async () => false,
    };
    const broken: SentrySdk = {
      captureException: () => "id",
      flush: () => Promise.reject(new Error("transport closed")),
    };

    await expect(sentryErrorReporter(late).flush(10)).resolves.toBe(false);
    await expect(sentryErrorReporter(broken).flush(10)).resolves.toBe(false);
  });
});
