import { inspect } from "node:util";
import { describe, expect, it } from "vitest";

import type { E164Phone } from "@/lib/phone";
import { createTestDb } from "@/test/db";
import { FakeClock } from "@/test/fakes/clock";

import { readCapturedEmail } from "./email-capture";
import { captureSmsSender, readCapturedSms } from "./sms-capture";
import { smsSenderContract } from "./sms.contract";

const ASHA = "+919876543210" as E164Phone;

smsSenderContract("captureSmsSender", async () => {
  const db = await createTestDb();
  const clock = new FakeClock();
  return {
    sender: captureSmsSender({ db, clock }),
    inbox: (to) => readCapturedSms({ db, clock }, { to }),
    clock,
  };
});

const message = {
  to: ASHA,
  template: "sign-in-code" as const,
  vars: { code: "482913", minutes: "10" },
  text: "Your sign-in code is 482913.",
};

describe("captureSmsSender", () => {
  it("stores the message in the capture mailbox as an SMS", async () => {
    const db = await createTestDb();
    const clock = new FakeClock();
    await captureSmsSender({ db, clock }).send(message);

    const { rows } = await db.$client.query<Record<string, unknown>>(
      "select channel, to_address, subject, body_text from captured_message"
    );
    expect(rows).toEqual([
      {
        channel: "sms",
        to_address: "+919876543210",
        subject: null,
        body_text: "Your sign-in code is 482913.",
      },
    ]);
  });

  it("keeps SMS and email apart", async () => {
    const db = await createTestDb();
    const clock = new FakeClock();
    await captureSmsSender({ db, clock }).send(message);

    expect(
      await readCapturedEmail({ db, clock }, { to: "+919876543210" })
    ).toEqual([]);
  });

  it("drops captured messages more than seven days old", async () => {
    const db = await createTestDb();
    const clock = new FakeClock();
    const sender = captureSmsSender({ db, clock });

    await sender.send({ ...message, text: "first" });
    clock.advance({ days: 7, milliseconds: 1 });
    await sender.send({ ...message, text: "a week on" });

    const kept = await readCapturedSms({ db, clock }, { to: ASHA });
    expect(kept.map((received) => received.text)).toEqual(["a week on"]);
    const { rows } = await db.$client.query<{ kept: number }>(
      "select count(*)::int as kept from captured_message"
    );
    expect(rows).toEqual([{ kept: 1 }]);
  });

  it("fails with neither the number nor the message in the error", async () => {
    const db = await createTestDb();
    const clock = new FakeClock();
    await db.$client.exec(
      "ALTER TABLE captured_message ADD CONSTRAINT refuse_all CHECK (false) NOT VALID"
    );

    const error: unknown = await captureSmsSender({ db, clock })
      .send(message)
      .then(
        () => null,
        (failure: unknown) => failure
      );

    expect(error).toMatchObject({ code: "23514" });
    const everything = inspect(error, { depth: 10, showHidden: true });
    expect(everything).not.toContain("9876543210");
    expect(everything).not.toContain("482913");
  });
});
