import { describe, expect, it } from "vitest";

import { settingsFor } from "./settings";

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
