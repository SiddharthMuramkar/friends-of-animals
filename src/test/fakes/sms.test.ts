import { describe, expect, it } from "vitest";

import type { E164Phone } from "@/lib/phone";
import { smsSenderContract } from "@/server/ports/sms.contract";

import { FakeClock } from "./clock";
import { FakeSms } from "./sms";

const ASHA = "+919876543210" as E164Phone;

smsSenderContract("FakeSms", async () => {
  const clock = new FakeClock();
  const sms = new FakeSms(clock);
  return { sender: sms, inbox: async (to) => sms.inbox(to), clock };
});

function code(value: string) {
  return {
    to: ASHA,
    template: "sign-in-code" as const,
    vars: { code: value, minutes: "10" },
    text: `Your sign-in code is ${value}. It works for 10 minutes.`,
  };
}

describe("FakeSms", () => {
  it("records every message sent, oldest first, with its template", async () => {
    const sms = new FakeSms(new FakeClock());
    await sms.send(code("111111"));
    await sms.send(code("222222"));

    expect(sms.sent.map((message) => message.vars.code)).toEqual([
      "111111",
      "222222",
    ]);
    expect(sms.sent[0]?.template).toBe("sign-in-code");
  });

  it("finds the last message and its code by any spelling of the number", async () => {
    const sms = new FakeSms(new FakeClock());
    await sms.send(code("111111"));
    await sms.send(code("222222"));

    expect(sms.lastTo("+91 98765 43210")?.vars.code).toBe("222222");
    expect(sms.codeFor("098765 43210")).toBe("222222");
    expect(sms.lastTo("+919123456780")).toBeUndefined();
  });

  it("fails the next sends when told to, then recovers", async () => {
    const sms = new FakeSms(new FakeClock());
    sms.failNext(1, new Error("MSG91 is down"));

    await expect(sms.send(code("111111"))).rejects.toThrow("MSG91 is down");
    await sms.send(code("222222"));

    expect(sms.sent).toHaveLength(1);
  });
});
