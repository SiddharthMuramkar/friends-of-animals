import { describe, expect, it } from "vitest";

import { createTestDb } from "@/test/db";
import { FakeClock } from "@/test/fakes/clock";

import type { E164Phone } from "@/lib/phone";

import { emailSenderFor, settingsFor, smsSenderFor } from "./deps";
import { EmailNotConfiguredError } from "./ports/email";
import { readCapturedEmail } from "./ports/email-capture";
import { SmsNotConfiguredError } from "./ports/sms";
import { readCapturedSms } from "./ports/sms-capture";

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

const sms = {
  to: "+919876543210" as E164Phone,
  template: "sign-in-code" as const,
  vars: { code: "123456", minutes: "10" },
  text: "Your code is 123456",
};

const MSG91 = { authKey: "msg91-key", otpTemplateId: "otp-template" };

/** A fetch that counts calls and accepts every message. */
function countingFetch() {
  const counter = { calls: 0 };
  const fetch = (async () => {
    counter.calls += 1;
    return Response.json({ type: "success", message: "request-id" });
  }) as typeof globalThis.fetch;
  return { fetch, counter };
}

describe("smsSenderFor", () => {
  it.each(["local", "preview", "staging"] as const)(
    "captures SMS on %s and never calls MSG91, even with its keys",
    async (appEnv) => {
      const deps = { db: await createTestDb(), clock: new FakeClock() };
      const { fetch, counter } = countingFetch();
      const sender = smsSenderFor(appEnv, deps, MSG91, fetch);

      await sender.send(sms);

      const inbox = await readCapturedSms(deps, { to: sms.to });
      expect(inbox.map((received) => received.text)).toEqual([
        "Your code is 123456",
      ]);
      expect(counter.calls).toBe(0);
    }
  );

  it("sends through MSG91 in production when its keys are set", async () => {
    const deps = { db: await createTestDb(), clock: new FakeClock() };
    const { fetch, counter } = countingFetch();

    await smsSenderFor("production", deps, MSG91, fetch).send(sms);

    expect(counter.calls).toBe(1);
    expect(await readCapturedSms(deps, { to: sms.to })).toEqual([]);
  });

  it("refuses in production while MSG91 is not configured", async () => {
    const deps = { db: await createTestDb(), clock: new FakeClock() };
    const { fetch, counter } = countingFetch();

    for (const config of [{}, { authKey: "msg91-key" }]) {
      const sender = smsSenderFor("production", deps, config, fetch);
      await expect(sender.send(sms)).rejects.toBeInstanceOf(
        SmsNotConfiguredError
      );
    }
    expect(counter.calls).toBe(0);
    expect(await readCapturedSms(deps, { to: sms.to })).toEqual([]);
  });
});

describe("settingsFor", () => {
  it.each([
    ["local", true],
    ["preview", true],
    ["staging", false],
    ["production", false],
  ] as const)("reads sms.enabled on %s as %s", async (appEnv, enabled) => {
    expect(await settingsFor(appEnv).get("sms.enabled")).toBe(enabled);
  });

  it.each(["local", "preview", "staging", "production"] as const)(
    "keeps FOA's ceiling on texts on %s: 200 an hour, 1,000 a day",
    async (appEnv) => {
      const settings = settingsFor(appEnv);

      expect(await settings.get("sms.maxPerHour")).toBe(200);
      expect(await settings.get("sms.maxPerDay")).toBe(1000);
    }
  );
});
