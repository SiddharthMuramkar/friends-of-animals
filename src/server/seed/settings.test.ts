import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { setting } from "@/server/db/schema";
import { readSetting } from "@/server/modules/settings";
import { createHarness } from "@/test/harness";

describe("the settings seed", () => {
  it("stores every setting once, however often it runs: the defaults, with SMS on", async () => {
    const h = await createHarness();
    const rows = () => h.db.select().from(setting).orderBy(asc(setting.key));

    await h.seed.preview();
    const first = await rows();
    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(await rows()).toEqual(first);
    expect(first.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "auth.emailSignIn", value: true },
      { key: "auth.staffSessionHours", value: 12 },
      { key: "org.fcraEnabled", value: false },
      { key: "org.has80G", value: false },
      { key: "safeguarding.reportsPerIpPerHour", value: 10 },
      { key: "sms.enabled", value: true },
      { key: "sms.maxPerDay", value: 1000 },
      { key: "sms.maxPerHour", value: 200 },
    ]);
  });

  it("turns sign-in by text on where it seeds: local runs and previews capture texts", async () => {
    const h = await createHarness();
    const visitor = h.visitor();
    expect((await h.as(visitor).signInMethods()).phone).toBe(false);

    await h.seed.preview();

    expect((await h.as(visitor).signInMethods()).phone).toBe(true);
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
