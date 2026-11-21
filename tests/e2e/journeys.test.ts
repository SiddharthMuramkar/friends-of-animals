import { describe, expect, test } from "vitest";

import { MILESTONE_JOURNEYS } from "./journeys";

const isJourney = (path: string) => MILESTONE_JOURNEYS.test(path);

describe("milestone journeys", () => {
  test("the M5 journey is one, on a Linux or a Windows path", () => {
    expect(
      isJourney(
        "/home/runner/work/foa/foa/tests/e2e/m5-donation-transparency.spec.ts"
      )
    ).toBe(true);
    expect(
      isJourney("C:\\work\\foa\\tests\\e2e\\m5-donation-transparency.spec.ts")
    ).toBe(true);
  });

  test("ticket specs, Vitest files and helpers are not", () => {
    for (const path of [
      "/repo/tests/e2e/smoke.spec.ts",
      "/repo/tests/e2e/57-email-otp.spec.ts",
      "/repo/tests/e2e/110-transparency.spec.ts",
      "/repo/tests/e2e/mobile-menu.spec.ts",
      "/repo/tests/e2e/m5-donation-transparency.test.ts",
      "/repo/tests/e2e/support/m5-steps.ts",
    ]) {
      expect(isJourney(path), path).toBe(false);
    }
  });
});
