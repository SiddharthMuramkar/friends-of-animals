// Seam 1 for runtime settings (#62): the typed accessor and the settings
// use cases, on PGlite with the real migrations.

import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import { readSetting } from "./index";

describe("readSetting", () => {
  it("returns each setting's documented default on a fresh database", async () => {
    const h = await createHarness();

    expect(await readSetting(h.db, "auth.staffSessionHours")).toBe(12);
    expect(await readSetting(h.db, "sms.enabled")).toBe(false);
    expect(await readSetting(h.db, "org.has80G")).toBe(false);
    expect(await readSetting(h.db, "org.fcraEnabled")).toBe(false);
  });
});
