import { describe, expect, it } from "vitest";

import { createTestDb } from "@/test/db";
import { FakeClock } from "@/test/fakes/clock";

import { captureEmailSender, readCapturedEmail } from "./email-capture";
import { emailSenderContract } from "./email.contract";

emailSenderContract("captureEmailSender", async () => {
  const db = await createTestDb();
  const clock = new FakeClock();
  return {
    sender: captureEmailSender({ db, clock }),
    inbox: (to) => readCapturedEmail(db, { to }),
    clock,
  };
});

describe("captureEmailSender", () => {
  // Staging captures real visitors' addresses and codes, so the mailbox
  // keeps a week of messages, not everything ever sent.
  it("drops captured messages more than seven days old", async () => {
    const db = await createTestDb();
    const clock = new FakeClock();
    const sender = captureEmailSender({ db, clock });
    const to = "asha@example.test";

    await sender.send({ to, subject: "first", text: "Your code is 111111" });
    clock.advance({ days: 7 });
    await sender.send({
      to,
      subject: "a week on",
      text: "Your code is 222222",
    });
    clock.advance({ milliseconds: 1 });
    await sender.send({
      to: "ravi@example.test",
      subject: "for Ravi",
      text: "Your code is 333333",
    });

    const kept = await readCapturedEmail(db, { to });
    expect(kept.map((message) => message.subject)).toEqual(["a week on"]);
  });
});

describe("readCapturedEmail", () => {
  it("returns at most `limit` messages, newest first", async () => {
    const db = await createTestDb();
    const clock = new FakeClock();
    const sender = captureEmailSender({ db, clock });
    for (const subject of ["1", "2", "3"]) {
      await sender.send({ to: "asha@example.test", subject, text: subject });
      clock.advance({ seconds: 1 });
    }

    const latest = await readCapturedEmail(db, {
      to: "asha@example.test",
      limit: 2,
    });
    expect(latest.map((message) => message.subject)).toEqual(["3", "2"]);
  });
});
