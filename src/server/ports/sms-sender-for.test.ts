import { describe, expect, it } from "vitest";

import { createTestDb } from "@/test/db";
import { FakeClock } from "@/test/fakes/clock";

import type { E164Phone } from "@/lib/phone";

import { SmsNotConfiguredError } from "./sms";
import { readCapturedSms } from "./sms-capture";
import { smsSenderFor } from "./sms-sender-for";

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
