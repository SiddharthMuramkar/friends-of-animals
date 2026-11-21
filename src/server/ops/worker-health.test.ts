import { describe, expect, it } from "vitest";

import { workerFreshness } from "./worker-health";

const NOW = new Date("2026-11-21T10:00:00.000Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe("workerFreshness", () => {
  it.each([
    {
      case: "a beat 5 s ago",
      rows: [{ worker: "worker-staging", lastSeenAt: ago(5) }],
      expected: {
        status: "ok",
        worker: { name: "worker-staging", ageSeconds: 5 },
      },
    },
    {
      case: "a beat exactly 120 s ago",
      rows: [{ worker: "worker-staging", lastSeenAt: ago(120) }],
      expected: {
        status: "ok",
        worker: { name: "worker-staging", ageSeconds: 120 },
      },
    },
    {
      case: "a beat 120.5 s ago",
      rows: [{ worker: "worker-staging", lastSeenAt: ago(120.5) }],
      expected: {
        status: "stale",
        worker: { name: "worker-staging", ageSeconds: 120 },
      },
    },
    {
      case: "a beat 121 s ago",
      rows: [{ worker: "worker-staging", lastSeenAt: ago(121) }],
      expected: {
        status: "stale",
        worker: { name: "worker-staging", ageSeconds: 121 },
      },
    },
    {
      case: "the freshest of two beats",
      rows: [
        { worker: "worker-old", lastSeenAt: ago(3600) },
        { worker: "worker-staging", lastSeenAt: ago(30) },
      ],
      expected: {
        status: "ok",
        worker: { name: "worker-staging", ageSeconds: 30 },
      },
    },
    {
      // The worker's clock runs a little ahead of the app's.
      case: "a beat 2 s in the future",
      rows: [{ worker: "worker-staging", lastSeenAt: ago(-2) }],
      expected: {
        status: "ok",
        worker: { name: "worker-staging", ageSeconds: 0 },
      },
    },
    { case: "no beat at all", rows: [], expected: { status: "missing" } },
  ])("$case → $expected.status", ({ rows, expected }) => {
    expect(workerFreshness(rows, NOW, { maxAgeSeconds: 120 })).toEqual(
      expected
    );
  });
});
