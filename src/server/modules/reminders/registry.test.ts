import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { messageRoute, messageTemplate } from "@/server/db/schema";
import { isSettingKey, SETTINGS } from "@/server/modules/settings/catalogue";
import { createHarness } from "@/test/harness";

import { REMINDERS } from "./registry";

// #84 84b: what each reminder in the registry needs, so a later one (#90,
// #93, #125) that forgets a part fails here: a unique name the table
// accepts, hour settings in the catalogue, and its template with routes
// on `reminder.due` for accounts and for contacts without one.

describe("the reminder registry", () => {
  it("names each reminder once, in lower snake case", () => {
    const names = REMINDERS.map((reminder) => reminder.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("times each reminder by hour settings that can turn it off", () => {
    for (const reminder of REMINDERS) {
      expect(reminder.offsetSettings.length, reminder.name).toBeGreaterThan(0);
      for (const key of reminder.offsetSettings) {
        expect(isSettingKey(key), key).toBe(true);
        expect(SETTINGS[key].input, key).toMatchObject({
          kind: "integer",
          min: 0,
          unit: "hours",
        });
      }
    }
  });

  it("has the migrated template and both routes of every reminder", async () => {
    const h = await createHarness();
    for (const { name, templateKey } of REMINDERS) {
      const channels = await h.db
        .select({ channel: messageTemplate.channel })
        .from(messageTemplate)
        .where(eq(messageTemplate.key, templateKey));
      expect(channels.map((row) => row.channel).sort(), name).toEqual([
        "email",
        "in_app",
        "sms",
      ]);
      const routes = await h.db
        .select({
          audience: messageRoute.audience,
          channels: messageRoute.channels,
        })
        .from(messageRoute)
        .where(
          and(
            eq(messageRoute.eventType, "reminder.due"),
            eq(messageRoute.templateKey, templateKey)
          )
        );
      expect(
        routes.toSorted((a, b) => a.audience.localeCompare(b.audience)),
        name
      ).toEqual([
        { audience: "reminder_contacts", channels: ["email", "sms"] },
        {
          audience: "reminder_registrants",
          channels: ["email", "sms", "in_app"],
        },
      ]);
    }
  });
});
