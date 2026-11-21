import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { setting } from "@/server/db/schema";
import { readSetting } from "@/server/settings";
import { createHarness } from "@/test/harness";

describe("the settings seed", () => {
  it("stores the first four settings at their defaults, once however often it runs", async () => {
    const h = await createHarness();
    const rows = () => h.db.select().from(setting).orderBy(asc(setting.key));

    await h.seed.preview();
    const first = await rows();
    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(await rows()).toEqual(first);
    expect(first.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "auth.staffSessionHours", value: 12 },
      { key: "org.fcraEnabled", value: false },
      { key: "org.has80G", value: false },
      { key: "sms.enabled", value: false },
    ]);
  });

  it("keeps a value someone changed on the preview", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const admin = await h.signIn(await h.seed.superAdmin());
    await h.as(admin).changeSetting({ key: "org.has80G", value: true });

    await h.seed.preview();

    expect(await readSetting(h.db, "org.has80G")).toBe(true);
  });
});
