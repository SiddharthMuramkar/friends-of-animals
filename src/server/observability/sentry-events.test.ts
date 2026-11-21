// What really leaves for Sentry: the real `@sentry/nextjs` server SDK,
// started with our options, with a transport that records each envelope
// instead of sending it. Real PGlite + Drizzle errors go through the
// Sentry adapter, so linked causes, console breadcrumbs and the SDK's own
// data collection are all in play. No network.

import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { errorTracking, sentryOptions } from "@/lib/observability/config";
import { session, user } from "@/server/db/schema";
import { hashUserId } from "@/server/ports/errors";
import { sentryErrorReporter } from "@/server/ports/errors-sentry";
import { createTestDb } from "@/test/db";

const USER_ID = "0190a000-0000-7000-8000-000000000002";

/**
 * A value made up at run time. The SDK attaches source lines to stack
 * frames, so a literal in this file would show up in the envelope anyway.
 */
const unique = () => randomBytes(6).toString("hex");
const envelopes: string[] = [];
const decoder = new TextDecoder();
const reporter = sentryErrorReporter(Sentry);

beforeAll(() => {
  // The SDK's console integration wraps this, so logged errors become
  // breadcrumbs without printing.
  vi.spyOn(console, "error").mockImplementation(() => {});
  const tracking = errorTracking({
    dsn: "https://abc123@o1.ingest.us.sentry.io/4507",
    appEnv: "staging",
  });
  if (!tracking.enabled) throw new Error("tracking should be on");
  Sentry.init({
    ...sentryOptions(tracking, { hashUserId }),
    transport: (options: Parameters<typeof Sentry.createTransport>[0]) =>
      Sentry.createTransport(options, async (request) => {
        envelopes.push(
          typeof request.body === "string"
            ? request.body
            : decoder.decode(request.body)
        );
        return { statusCode: 200 };
      }),
  });
});

afterAll(async () => {
  await Sentry.close(2000);
  vi.restoreAllMocks();
});

/** Reports `error` as a use case would, after logging it, and returns what was sent. */
async function sendThroughSentry(error: unknown): Promise<string> {
  const before = envelopes.length;
  console.error(error);
  reporter.report(error, { where: "use case", userId: USER_ID });
  await expect(reporter.flush(5000)).resolves.toBe(true);
  return envelopes.slice(before).join("\n");
}

async function failure(query: Promise<unknown>): Promise<unknown> {
  try {
    await query;
  } catch (error) {
    return error;
  }
  throw new Error("the query should have failed");
}

describe("events the real Sentry SDK sends", () => {
  it("carry no name or email from a refused insert, in the error or its cause", async () => {
    const db = await createTestDb();
    const surname = unique();
    const name = `Ravi ${surname}`;
    // Not lower-cased, so the user_email_normalised check refuses it.
    const email = `Ravi.${surname}@Example.test`;
    const refused = await failure(
      db.insert(user).values({
        id: USER_ID,
        name,
        email,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    );

    const sent = await sendThroughSentry(refused);

    // The event really went, with the query, its cause and the breadcrumb.
    expect(sent).toContain("Failed query: insert into");
    expect(sent).toContain("params: [redacted]");
    expect(sent).toContain("violates check constraint");
    expect(sent).toContain(hashUserId(USER_ID));
    for (const personal of [name, surname, email, USER_ID]) {
      expect(sent).not.toContain(personal);
    }
    await db.$client.close();
  });

  it("carry no session token from a failed lookup", async () => {
    const db = await createTestDb();
    const token = `not-a-uuid-${unique()}`;
    const failed = await failure(
      db.select().from(session).where(eq(session.id, token))
    );

    const sent = await sendThroughSentry(failed);

    expect(sent).toContain("invalid input syntax for type uuid");
    expect(sent).not.toContain(token);
    await db.$client.close();
  });

  it("include no spans, even for a request whose caller asks to sample its trace", async () => {
    const before = envelopes.length;
    const query = `email=${unique()}@example.test`;

    // What a request with `sentry-trace: <trace>-<span>-1` sets up.
    Sentry.continueTrace(
      {
        sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
        baggage: "sentry-sampled=true,sentry-sample_rate=1",
      },
      () => {
        Sentry.startSpan(
          {
            name: `GET /sign-in?${query}`,
            attributes: { "http.target": `/sign-in?${query}` },
          },
          () => {
            Sentry.startSpan({ name: "db.query" }, () => {});
          }
        );
      }
    );
    await Sentry.flush(5000);

    const sent = envelopes.slice(before).join("\n");
    expect(sent).not.toMatch(/"type":"(span|transaction)"/);
    expect(sent).not.toContain(query);
  });
});
