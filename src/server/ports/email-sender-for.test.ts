import { describe, expect, it } from "vitest";

import { createTestDb } from "@/test/db";
import { FakeClock } from "@/test/fakes/clock";
import { FakeSes } from "@/test/fakes/ses";

import { EmailNotConfiguredError } from "./email";
import { readCapturedEmail } from "./email-capture";
import { emailSenderFor } from "./email-sender-for";

const message = { to: "asha@example.test", subject: "Code", text: "123456" };

/** SES's variables as production sets them (src/env.schema.ts). */
const SES = {
  SES_REGION: "ap-south-1",
  SES_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  SES_SECRET_ACCESS_KEY: "test-ses-secret-access-key",
  SES_FROM: "Friends of Animals <no-reply@friendsofanimals.dev>",
};

async function setup() {
  const clock = new FakeClock();
  return {
    deps: { db: await createTestDb(), clock },
    ses: new FakeSes(clock),
  };
}

describe("emailSenderFor", () => {
  it.each(["local", "preview", "staging"] as const)(
    "captures email on %s and never calls SES, even with its keys",
    async (appEnv) => {
      const { deps, ses } = await setup();
      const sender = emailSenderFor(appEnv, deps, SES, ses.handler);

      await sender.send(message);

      const inbox = await readCapturedEmail(deps, { to: message.to });
      expect(inbox.map((received) => received.text)).toEqual(["123456"]);
      expect(ses.requests).toEqual([]);
    }
  );

  it("sends through SES in production when its keys and sender are set", async () => {
    const { deps, ses } = await setup();

    await emailSenderFor("production", deps, SES, ses.handler).send(message);

    expect(ses.inbox(message.to).map((received) => received.text)).toEqual([
      "123456",
    ]);
    expect(ses.requests[0]?.hostname).toBe("email.ap-south-1.amazonaws.com");
    expect(ses.requests[0]?.body.FromEmailAddress).toBe(SES.SES_FROM);
    expect(await readCapturedEmail(deps, { to: message.to })).toEqual([]);
  });

  it("sends through SES_CONFIGURATION_SET when one is set", async () => {
    const { deps, ses } = await setup();
    const config = { ...SES, SES_CONFIGURATION_SET: "foa-prod" };

    await emailSenderFor("production", deps, config, ses.handler).send(message);

    expect(ses.requests[0]?.body.ConfigurationSetName).toBe("foa-prod");
  });

  it("never captures in production, and refuses while SES is not configured", async () => {
    const { deps, ses } = await setup();
    const { SES_FROM: _from, ...withoutSender } = SES;

    for (const config of [{}, { SES_REGION: "ap-south-1" }, withoutSender]) {
      const sender = emailSenderFor("production", deps, config, ses.handler);

      await expect(sender.send(message)).rejects.toBeInstanceOf(
        EmailNotConfiguredError
      );
    }
    expect(ses.requests).toEqual([]);
    expect(await readCapturedEmail(deps, { to: message.to })).toEqual([]);
  });
});
