import { describe, expect, it, vi } from "vitest";

import { reportBoundaryError } from "./boundary";

describe("reportBoundaryError", () => {
  it("reports an error thrown in the browser", () => {
    const report = vi.fn();
    const error = new TypeError("Cannot read properties of undefined");

    reportBoundaryError(error, report);

    expect(report).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("only logs a server error, which the server already reported", () => {
    const report = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("An error occurred"), {
      digest: "2398765123",
    });

    reportBoundaryError(error, report);

    expect(report).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledExactlyOnceWith(error);
    log.mockRestore();
  });
});
