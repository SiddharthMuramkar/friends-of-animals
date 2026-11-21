import { describe, expect, it } from "vitest";

import { createTestDb } from "@/test/db";
import { FakeClock } from "@/test/fakes/clock";

import { emailSenderFor } from "./deps";
import { EmailNotConfiguredError } from "./ports/email";
import { readCapturedEmail } from "./ports/email-capture";

const message = { to: "asha@example.test", subject: "Code", text: "123456" };

describe("emailSenderFor", () => {
  it.each(["local", "preview", "staging"] as const)(
    "captures email on %s instead of sending it",
    async (appEnv) => {
      const deps = { db: await createTestDb(), clock: new FakeClock() };
      const sender = emailSenderFor(appEnv, deps);

      await sender.send(message);

      const inbox = await readCapturedEmail(deps, { to: message.to });
      expect(inbox.map((received) => received.text)).toEqual(["123456"]);
    }
  );

  it("never captures in production, and refuses while SES is not wired", async () => {
    const deps = { db: await createTestDb(), clock: new FakeClock() };
    const sender = emailSenderFor("production", deps);

    await expect(sender.send(message)).rejects.toBeInstanceOf(
      EmailNotConfiguredError
    );
    expect(await readCapturedEmail(deps, { to: message.to })).toEqual([]);
  });
});
