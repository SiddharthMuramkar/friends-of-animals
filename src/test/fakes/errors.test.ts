import { describe, expect, it } from "vitest";

import { errorReporterContract } from "@/server/ports/errors.contract";

import { FakeErrorReporter } from "./errors";

errorReporterContract("FakeErrorReporter", async () => {
  const reporter = new FakeErrorReporter();
  return {
    reporter,
    sent: () => reporter.reported.map(({ error: _error, ...event }) => event),
  };
});

describe("FakeErrorReporter", () => {
  it("keeps the reported value itself for assertions", () => {
    const reporter = new FakeErrorReporter();
    const error = new Error("boom");
    reporter.report(error, { where: "test" });

    expect(reporter.reported).toHaveLength(1);
    expect(reporter.reported[0]?.error).toBe(error);
  });
});
