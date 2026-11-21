import { describe, expect, it } from "vitest";

import { summarizeError } from "./log";

describe("summarizeError", () => {
  it("names a refused connection by its system code", () => {
    const refused = Object.assign(
      new Error("connect ECONNREFUSED 10.112.12.11:5432"),
      { code: "ECONNREFUSED" }
    );

    expect(summarizeError(refused)).toBe("Error (ECONNREFUSED)");
  });

  it("finds the system code behind pg's AggregateError", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED ::1:5432"), {
      code: "ECONNREFUSED",
    });

    expect(summarizeError(new AggregateError([refused], ""))).toBe(
      "AggregateError (ECONNREFUSED)"
    );
  });

  it("gives Postgres errors their SQLSTATE and never the message", () => {
    const gone = Object.assign(
      new Error('database "foa_pr_7_0a1b2c3d" does not exist'),
      { code: "3D000" }
    );

    expect(summarizeError(gone)).toBe("Error (Postgres 3D000)");
  });

  it("keeps a message-free summary for anything else", () => {
    expect(summarizeError(new TypeError("asha@example.test"))).toBe(
      "TypeError"
    );
    expect(summarizeError("boom")).toBe("a thrown string");
  });
});
