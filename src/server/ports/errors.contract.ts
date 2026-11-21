// Shared contract for every ErrorReporter adapter that sends events. The
// in-memory fake and the Sentry adapter (over a recording SDK stub that
// applies the SDK's `beforeSend`) both run it, so the fake stays faithful:
// what a test sees in the fake is what would leave for Sentry. Only
// imported by *.test.ts.

import { describe, expect, it } from "vitest";

import { hashUserId, type ErrorReporter } from "./errors";

/** One event as it leaves for Sentry, reduced to what the contract checks. */
export type SentEvent = {
  /** The error's type, e.g. "TypeError". */
  type: string;
  /** The error's message, scrubbed. */
  message: string;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  user?: { id: string };
};

export type ErrorReporterContractSetup = () => Promise<{
  reporter: ErrorReporter;
  /** Every event sent so far, oldest first. */
  sent: () => SentEvent[];
}>;

const USER_ID = "0193a7b0-5c1e-7d2f-9a4b-8c6d2e1f3a5b";

export function errorReporterContract(
  name: string,
  setup: ErrorReporterContractSetup
) {
  describe(`${name} (ErrorReporter contract)`, () => {
    it("sends one event with the error's type, message, tags and extra", async () => {
      const { reporter, sent } = await setup();
      reporter.report(new TypeError("Card declined"), {
        where: "checkout",
        tags: { "route.type": "action" },
        extra: { attempt: 2 },
      });

      expect(sent()).toEqual([
        {
          type: "TypeError",
          message: "Card declined",
          tags: { where: "checkout", "route.type": "action" },
          extra: { attempt: 2 },
        },
      ]);
    });

    it("removes personal data before the event leaves", async () => {
      const { reporter, sent } = await setup();
      reporter.report(
        new Error("No account for asha@example.test on +91 98765 43210"),
        {
          tags: { path: "/sign-in?email=asha@example.test" },
          extra: {
            name: "Asha Rao",
            email: "asha@example.test",
            form: { phone: "9876543210", school: "Hill Public School" },
            cookie: "session=abc123",
          },
        }
      );

      const [event] = sent();
      expect(event).toEqual({
        type: "Error",
        message: "No account for [email] on [phone]",
        tags: { path: "/sign-in" },
        extra: {
          name: "[redacted]",
          email: "[redacted]",
          form: { phone: "[redacted]", school: "Hill Public School" },
          cookie: "[redacted]",
        },
      });
      const text = JSON.stringify(sent());
      for (const personal of ["asha", "Asha", "98765", "session=abc123"]) {
        expect(text).not.toContain(personal);
      }
    });

    it("identifies the user only by the hash of their id", async () => {
      const { reporter, sent } = await setup();
      reporter.report(new Error("boom"), { userId: USER_ID });

      expect(sent()[0]?.user).toEqual({ id: hashUserId(USER_ID) });
      expect(JSON.stringify(sent())).not.toContain(USER_ID);
    });

    it("sends no user when none is given", async () => {
      const { reporter, sent } = await setup();
      reporter.report(new Error("boom"));

      expect(sent()).toHaveLength(1);
      expect(sent()[0]).not.toHaveProperty("user");
    });

    it("sends one event for any thrown value, never throwing", async () => {
      const { reporter, sent } = await setup();
      for (const value of ["plain", { code: 42 }, undefined, null, 7]) {
        expect(() => reporter.report(value)).not.toThrow();
      }

      expect(sent()).toHaveLength(5);
      expect(sent()[0]?.message).toBe("plain");
    });

    it("has nothing left to send after a flush", async () => {
      const { reporter } = await setup();
      reporter.report(new Error("boom"));

      await expect(reporter.flush(100)).resolves.toBe(true);
    });
  });
}
