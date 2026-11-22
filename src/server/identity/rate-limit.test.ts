import { describe, expect, it } from "vitest";

import { createTestDb } from "@/test/db";

import { takeCodeAllowance } from "./rate-limit";
import { CODE_REQUEST_LIMITS } from "./settings";

// The per-IP limit is the one the caller passes: productionDeps picks it
// per environment (codeRequestLimitsFor), so a local run or a preview,
// where every E2E test asks from the CI runner's one address, isn't held
// to production's 20.

const NOW = new Date("2027-01-15T09:00:00.000Z");
const IP = "198.51.100.20";
const SECRET = "rate-limit-test-secret-0123456789abcdef";

async function askFromOneIp(perIp: number, times: number) {
  const db = await createTestDb();
  try {
    const answers = [];
    for (let i = 1; i <= times; i++) {
      answers.push(
        await takeCodeAllowance(db, {
          to: { channel: "email", key: `person-${i}@example.test` },
          ip: IP,
          now: NOW,
          secret: SECRET,
          limits: { ...CODE_REQUEST_LIMITS, perIp },
        })
      );
    }
    return answers;
  } finally {
    await db.$client.close();
  }
}

describe("takeCodeAllowance", () => {
  it("refuses one IP past the per-IP limit it is given", async () => {
    const answers = await askFromOneIp(3, 4);

    expect(answers.slice(0, 3)).toEqual([
      { ok: true },
      { ok: true },
      { ok: true },
    ]);
    expect(answers[3]).toMatchObject({ ok: false });
  });

  it("lets one IP ask for more than production's 20 when given a higher limit", async () => {
    const answers = await askFromOneIp(200, CODE_REQUEST_LIMITS.perIp + 1);

    expect(answers.every((answer) => answer.ok)).toBe(true);
  });
});
