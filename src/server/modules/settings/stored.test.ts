// The deps' runtime settings over the settings table (#62): what
// productionDeps(), the worker and the Seam 1 harness read, on PGlite with
// the real migrations.

import { describe, expect, it } from "vitest";

import { FIXED_SETTINGS } from "@/server/ports/settings";
import { createHarness } from "@/test/harness";

import { isSettingKey, storedSettings } from "./index";

describe("storedSettings", () => {
  it("reads SMS as off where nothing is stored, as on staging and production, which are never seeded", async () => {
    const h = await createHarness();

    expect(await storedSettings(h.db).get("sms.enabled")).toBe(false);
  });

  it("reads SMS as on where the preview seed stored it, as on previews and local runs", async () => {
    const h = await createHarness();
    await h.seed.preview();

    expect(await storedSettings(h.db).get("sms.enabled")).toBe(true);
  });

  it("reads a super admin's change at once, with no restart", async () => {
    const h = await createHarness();
    const settings = storedSettings(h.db);
    expect(await settings.get("sms.enabled")).toBe(false);
    const admin = await h.signIn(await h.seed.superAdmin());

    await h.as(admin).changeSetting({ key: "sms.enabled", value: true });

    expect(await settings.get("sms.enabled")).toBe(true);
  });

  it("keeps FOA's ceiling on texts everywhere: 200 an hour, 1,000 a day", async () => {
    const h = await createHarness();
    const settings = storedSettings(h.db);

    expect(await settings.get("sms.maxPerHour")).toBe(200);
    expect(await settings.get("sms.maxPerDay")).toBe(1000);
  });

  it("fixes no value the settings screen holds", () => {
    for (const key of Object.keys(FIXED_SETTINGS)) {
      expect(isSettingKey(key), key).toBe(false);
    }
  });
});
