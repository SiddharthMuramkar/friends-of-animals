// Shared contract for every SmsSender that keeps what it sends: the
// in-memory fake and the capture adapter both run it, so the fake stays
// faithful. (MSG91 hands messages to the network; its own tests check
// the request it makes.) Only imported by *.test.ts.

import { describe, expect, it } from "vitest";

import type { E164Phone } from "@/lib/phone";
import type { FakeClock } from "@/test/fakes/clock";

import type { ReceivedSms, SmsMessage, SmsSender } from "./sms";

export type SmsContractSetup = () => Promise<{
  sender: SmsSender;
  /** The recipient's messages as the adapter stores them, newest first. */
  inbox: (to: E164Phone) => Promise<ReceivedSms[]>;
  clock: FakeClock;
}>;

const ASHA = "+919876543210" as E164Phone;
const RAVI = "+919123456780" as E164Phone;

function code(to: E164Phone, value: string): SmsMessage {
  return {
    to,
    template: "sign-in-code",
    vars: { code: value, minutes: "10" },
    text: `Your sign-in code is ${value}.`,
  };
}

export function smsSenderContract(name: string, setup: SmsContractSetup) {
  describe(`${name} (SmsSender contract)`, () => {
    it("delivers a message's text to its recipient", async () => {
      const { sender, inbox, clock } = await setup();
      await sender.send(code(ASHA, "123456"));

      expect(await inbox(ASHA)).toEqual([
        { to: ASHA, text: "Your sign-in code is 123456.", sentAt: clock.now() },
      ]);
    });

    it("keeps each recipient's messages apart", async () => {
      const { sender, inbox } = await setup();
      await sender.send(code(ASHA, "111111"));
      await sender.send(code(RAVI, "222222"));

      const texts = (await inbox(RAVI)).map((message) => message.text);
      expect(texts).toEqual(["Your sign-in code is 222222."]);
      expect(await inbox("+919000000999" as E164Phone)).toEqual([]);
    });

    it("lists the newest message first", async () => {
      const { sender, inbox, clock } = await setup();
      await sender.send(code(ASHA, "111111"));
      clock.advance({ seconds: 30 });
      await sender.send(code(ASHA, "222222"));

      const texts = (await inbox(ASHA)).map((message) => message.text);
      expect(texts).toEqual([
        "Your sign-in code is 222222.",
        "Your sign-in code is 111111.",
      ]);
    });

    it("lists messages sent at the same instant newest first", async () => {
      const { sender, inbox } = await setup();
      const sent = Array.from({ length: 10 }, (_, n) => `00000${n}`);
      for (const value of sent) await sender.send(code(ASHA, value));

      const texts = (await inbox(ASHA)).map((message) => message.text);
      expect(texts).toEqual(
        sent.toReversed().map((value) => `Your sign-in code is ${value}.`)
      );
    });
  });
}
