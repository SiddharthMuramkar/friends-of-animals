import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";

import { DomainError, errorSummaryForLogs } from "./errors";

describe("errorSummaryForLogs", () => {
  it("names a failed query and its Postgres code, not its parameters", () => {
    const cause = Object.assign(new Error('relation "x" does not exist'), {
      code: "42P01",
    });
    const error = new DrizzleQueryError(
      'insert into "captured_message" values ($1, $2)',
      ["asha@example.test", "Your sign-in code is 775623."],
      cause
    );

    expect(errorSummaryForLogs(error)).toBe(
      "DrizzleQueryError (Postgres 42P01)"
    );
  });

  it("names any other error by its class alone", () => {
    expect(
      errorSummaryForLogs(new DomainError("forbidden", "asha@example.test"))
    ).toBe("DomainError");
    expect(errorSummaryForLogs(new TypeError("asha@example.test"))).toBe(
      "TypeError"
    );
  });

  it("says what was thrown when it isn't an error", () => {
    expect(errorSummaryForLogs("asha@example.test")).toBe("a thrown string");
    expect(errorSummaryForLogs(undefined)).toBe("a thrown undefined");
  });
});
