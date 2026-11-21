import { afterEach, describe, expect, it } from "vitest";

import { silentErrorReporter } from "@/server/ports/errors";
import { FakeErrorReporter } from "@/test/fakes/errors";

import { serverErrorReporter, useServerErrorReporter } from "./server-reporter";

afterEach(() => {
  useServerErrorReporter(silentErrorReporter);
});

describe("serverErrorReporter", () => {
  it("is silent until the server starts error tracking", async () => {
    expect(() => serverErrorReporter.report(new Error("boom"))).not.toThrow();
    await expect(serverErrorReporter.flush(10)).resolves.toBe(true);
  });

  it("reports through the reporter the server started", async () => {
    const started = new FakeErrorReporter();
    useServerErrorReporter(started);

    const error = new Error("boom");
    serverErrorReporter.report(error, { where: "use case" });

    expect(started.reported.map((r) => r.error)).toEqual([error]);
    expect(started.reported[0]?.tags).toEqual({ where: "use case" });
    await expect(serverErrorReporter.flush(10)).resolves.toBe(true);
  });

  it("finds it through globalThis, so every server bundle shares it", () => {
    const started = new FakeErrorReporter();
    useServerErrorReporter(started);

    const key = Symbol.for("foa.serverErrorReporter");
    expect((globalThis as Record<symbol, unknown>)[key]).toBe(started);
  });
});
