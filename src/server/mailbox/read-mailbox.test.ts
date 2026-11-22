import { describe, expect, it } from "vitest";

import type { E164Phone } from "@/lib/phone";
import { captureEmailSender } from "@/server/ports/email-capture";
import { captureSmsSender } from "@/server/ports/sms-capture";
import { createTestDb } from "@/test/db";
import { FakeClock } from "@/test/fakes/clock";

import { readMailbox } from "./read-mailbox";

const TOKEN = "capture-mailbox-token-0123456789abcdef";
const ASHA = "asha@example.test";

async function mailboxWithOneCode() {
  const db = await createTestDb();
  const clock = new FakeClock();
  await captureEmailSender({ db, clock }).send({
    to: ASHA,
    subject: "Your sign-in code",
    text: "Your sign-in code is 482913.",
  });
  return { db, clock };
}

const request = {
  appEnv: "preview" as const,
  configuredToken: TOKEN,
  providedToken: TOKEN,
  to: ASHA,
};

describe("readMailbox", () => {
  it("gives the token holder an address's newest messages", async () => {
    const mailbox = await mailboxWithOneCode();

    expect(await readMailbox(mailbox, request)).toEqual({
      status: 200,
      body: {
        messages: [
          {
            subject: "Your sign-in code",
            text: "Your sign-in code is 482913.",
            sentAt: mailbox.clock.now().toISOString(),
          },
        ],
      },
    });
  });

  it("does not exist in production, even with the token", async () => {
    const mailbox = await mailboxWithOneCode();
    expect(
      await readMailbox(mailbox, { ...request, appEnv: "production" })
    ).toEqual({ status: 404 });
  });

  it("stays closed while no token is configured", async () => {
    const mailbox = await mailboxWithOneCode();
    expect(
      await readMailbox(mailbox, { ...request, configuredToken: undefined })
    ).toEqual({ status: 404 });
  });

  it.each([
    ["no token", null],
    ["a wrong token", "capture-mailbox-token-0123456789abcdeX"],
    ["a token of another length", "short"],
  ])("refuses %s", async (_, providedToken) => {
    const mailbox = await mailboxWithOneCode();
    expect(await readMailbox(mailbox, { ...request, providedToken })).toEqual({
      status: 401,
    });
  });

  it("asks for an address to read", async () => {
    const mailbox = await mailboxWithOneCode();
    expect(await readMailbox(mailbox, { ...request, to: null })).toEqual({
      status: 400,
    });
  });

  it("reads a phone's text messages, by any spelling of the number", async () => {
    const mailbox = await mailboxWithOneCode();
    await captureSmsSender(mailbox).send({
      to: "+919876543210" as E164Phone,
      template: "sign-in-code",
      vars: { code: "731905", minutes: "10" },
      text: "Your sign-in code is 731905.",
    });

    for (const to of ["+919876543210", "098765 43210"]) {
      expect(await readMailbox(mailbox, { ...request, to })).toEqual({
        status: 200,
        body: {
          messages: [
            {
              subject: "",
              text: "Your sign-in code is 731905.",
              sentAt: mailbox.clock.now().toISOString(),
            },
          ],
        },
      });
    }
  });
});
