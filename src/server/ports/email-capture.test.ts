import { inspect } from "node:util";
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
    inbox: (to) => readCapturedEmail({ db, clock }, { to }),
    clock,
  };
});

describe("captureEmailSender", () => {
  it("shows only the last week of captures in the mailbox", async () => {
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

    const kept = await readCapturedEmail({ db, clock }, { to });
    expect(kept.map((message) => message.subject)).toEqual(["a week on"]);
  });

  // A failed query's error lists its parameters: the address and the body,
  // sign-in code included. Whatever logs the error must not see them.
  it("fails with neither the address nor the message in the error", async () => {
    const db = await createTestDb();
    const clock = new FakeClock();
    await db.$client.exec(
      "ALTER TABLE captured_message ADD CONSTRAINT refuse_all CHECK (false) NOT VALID"
    );
    const sender = captureEmailSender({ db, clock });

    const error: unknown = await sender
      .send({
        to: "asha@example.test",
        subject: "Your sign-in code",
        text: "Your sign-in code is 775623.",
      })
      .then(
        () => null,
        (failure: unknown) => failure
      );

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: "23514" });
    const everything = inspect(error, { depth: 10, showHidden: true });
    expect(everything).not.toContain("asha@example.test");
    expect(everything).not.toContain("775623");
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

    const latest = await readCapturedEmail(
      { db, clock },
      { to: "asha@example.test", limit: 2 }
    );
    expect(latest.map((message) => message.subject)).toEqual(["3", "2"]);
  });

  it("fails with no address in the error", async () => {
    const db = await createTestDb();
    const clock = new FakeClock();
    await db.$client.exec(
      'ALTER TABLE "captured_message" RENAME TO "captured_message_gone"'
    );

    const error: unknown = await readCapturedEmail(
      { db, clock },
      { to: "asha@example.test" }
    ).then(
      () => null,
      (failure: unknown) => failure
    );

    expect(error).toBeInstanceOf(Error);
    expect(inspect(error, { depth: 10, showHidden: true })).not.toContain(
      "asha@example.test"
    );
    expect(error).toMatchObject({ code: "42P01" });
  });

  it("leaves out messages past the week even without a later send", async () => {
    const db = await createTestDb();
    const clock = new FakeClock();
    const to = "asha@example.test";
    await captureEmailSender({ db, clock }).send({
      to,
      subject: "s",
      text: "t",
    });

    clock.advance({ days: 7 });
    const lastMoment = await readCapturedEmail({ db, clock }, { to });
    clock.advance({ milliseconds: 1 });
    const after = await readCapturedEmail({ db, clock }, { to });

    expect(lastMoment).toHaveLength(1);
    expect(after).toEqual([]);
  });
});
