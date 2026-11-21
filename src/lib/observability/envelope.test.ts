import { describe, expect, it } from "vitest";

import { parseDsn } from "./config";
import { envelopeUrl, tunnelEnvelope } from "./envelope";

const DSN_TEXT = "https://abc123@o1.ingest.us.sentry.io/4507";
const dsn = parseDsn(DSN_TEXT)!;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Envelope lines joined the way the browser SDK writes them. */
const envelope = (...lines: (string | object)[]) =>
  encoder.encode(
    lines
      .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
      .join("\n")
  );

const header = { event_id: "e1", dsn: DSN_TEXT, sdk: { name: "browser" } };

const options = { dsn, environment: "staging" };

/** Splits a forwarded envelope back into its header and items. */
function readForwarded(body: Uint8Array) {
  const lines = decoder.decode(body).split("\n");
  const items: { header: Record<string, unknown>; payload: string }[] = [];
  for (let i = 1; i + 1 < lines.length; i += 2) {
    items.push({ header: JSON.parse(lines[i]!), payload: lines[i + 1]! });
  }
  return { header: JSON.parse(lines[0]!), items };
}

describe("envelopeUrl", () => {
  it("is the project's envelope endpoint on the DSN's host", () => {
    expect(envelopeUrl(dsn)).toBe(
      "https://o1.ingest.us.sentry.io/api/4507/envelope/"
    );
    expect(envelopeUrl(parseDsn("http://k@localhost:9000/sentry/7")!)).toBe(
      "http://localhost:9000/sentry/api/7/envelope/"
    );
  });
});

describe("tunnelEnvelope", () => {
  it("forwards a scrubbed event, tagged with the server's environment", () => {
    const decision = tunnelEnvelope(
      envelope(header, { type: "event" }, {
        message: "No account for asha@example.test",
        environment: "production",
        request: { url: "https://shipped-it.dev/x?phone=9876543210" },
      }),
      options
    );

    expect(decision.kind).toBe("forward");
    if (decision.kind !== "forward") return;
    expect(decision.url).toBe(
      "https://o1.ingest.us.sentry.io/api/4507/envelope/"
    );
    const forwarded = readForwarded(decision.body);
    expect(forwarded.header).toEqual(header);
    expect(forwarded.items).toHaveLength(1);
    expect(JSON.parse(forwarded.items[0]!.payload)).toEqual({
      message: "No account for [email]",
      environment: "staging",
      request: { url: "https://shipped-it.dev/x" },
    });
  });

  it("gives each forwarded item its length in bytes", () => {
    const decision = tunnelEnvelope(
      envelope(header, { type: "event" }, { message: "नमस्ते" }),
      options
    );
    if (decision.kind !== "forward") throw new Error(decision.kind);
    const [item] = readForwarded(decision.body).items;
    expect(item!.header).toEqual({
      type: "event",
      length: encoder.encode(item!.payload).byteLength,
    });
    expect(item!.header.length).toBeGreaterThan(item!.payload.length);
  });

  it("refuses an envelope meant for another project, key or host", () => {
    for (const other of [
      "https://abc123@o1.ingest.us.sentry.io/9999",
      "https://other@o1.ingest.us.sentry.io/4507",
      "https://abc123@attacker.example/4507",
      "not a dsn",
    ]) {
      expect(
        tunnelEnvelope(
          envelope({ ...header, dsn: other }, { type: "event" }, {}),
          options
        )
      ).toEqual({ kind: "reject", status: 400, reason: "dsn" });
    }
    expect(
      tunnelEnvelope(envelope({ event_id: "e1" }, { type: "event" }, {}), options)
    ).toEqual({ kind: "reject", status: 400, reason: "dsn" });
  });

  it("refuses an envelope larger than the limit before reading it", () => {
    const body = envelope(header, { type: "event" }, { message: "x".repeat(50) });
    expect(tunnelEnvelope(body, { ...options, maxBytes: 40 })).toEqual({
      kind: "reject",
      status: 413,
      reason: "size",
    });
  });

  it("refuses a malformed envelope", () => {
    for (const body of [
      encoder.encode(""),
      encoder.encode("not json\n{}\n{}"),
      envelope(header, "not json", "{}"),
      envelope(header, { type: "event" }, "not json"),
      envelope(header, { type: "event", length: 999 }, "{}"),
    ]) {
      expect(tunnelEnvelope(body, options)).toEqual({
        kind: "reject",
        status: 400,
        reason: "malformed",
      });
    }
  });

  it("keeps client reports and drops sessions, replays, feedback and attachments", () => {
    const attachment = "line one\nline two";
    const decision = tunnelEnvelope(
      envelope(
        header,
        { type: "session" },
        { did: "user-1", attrs: { ip_address: "203.0.113.10" } },
        { type: "attachment", length: encoder.encode(attachment).byteLength },
        attachment,
        { type: "feedback" },
        { contact_email: "asha@example.test" },
        { type: "replay_event" },
        {},
        { type: "client_report" },
        { discarded_events: [{ reason: "queue_overflow", quantity: 1 }] },
        { type: "event" },
        { message: "kept" }
      ),
      options
    );

    if (decision.kind !== "forward") throw new Error(decision.kind);
    const { items } = readForwarded(decision.body);
    expect(items.map((item) => item.header.type)).toEqual([
      "client_report",
      "event",
    ]);
    expect(decoder.decode(decision.body)).not.toContain("example.test");
    expect(decoder.decode(decision.body)).not.toContain("203.0.113.10");
  });

  it("forwards nothing when no item may go through", () => {
    expect(
      tunnelEnvelope(envelope(header, { type: "session" }, { did: "u" }), options)
    ).toEqual({ kind: "drop" });
  });

  it("removes the user from the trace header and sets its environment", () => {
    const decision = tunnelEnvelope(
      envelope(
        {
          ...header,
          trace: {
            public_key: "abc123",
            environment: "production",
            user_id: "asha@example.test",
            user_segment: "vip",
            transaction: "/sign-in?email=asha@example.test",
          },
        },
        { type: "event" },
        {}
      ),
      options
    );
    if (decision.kind !== "forward") throw new Error(decision.kind);
    expect(readForwarded(decision.body).header.trace).toEqual({
      public_key: "abc123",
      environment: "staging",
      transaction: "/sign-in",
    });
  });
});
