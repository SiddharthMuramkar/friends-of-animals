// The default templates and routes (drizzle/*_69_notification_defaults.sql)
// against the code that sends them: every route's event, audience and
// template exist, and each template only uses what its events provide.
// A later ticket's migration that adds a route or a template runs here too.

import { describe, expect, it } from "vitest";

import { messageRoute, messageTemplate } from "@/server/db/schema";
import { EVENT_PAYLOADS, type EventType } from "@/server/outbox/events";
import { createHarness } from "@/test/harness";

import { isAudienceKey, variablesFor } from "./audiences";
import { checkTemplate } from "./domain/template";

function isEventType(type: string): type is EventType {
  return Object.hasOwn(EVENT_PAYLOADS, type);
}

describe("the message catalogue after migrations", () => {
  it("routes known events to known audiences and templates with the variables they provide", async () => {
    const h = await createHarness();
    const routes = await h.db.select().from(messageRoute);
    const templates = await h.db.select().from(messageTemplate);
    expect(routes.length).toBeGreaterThan(0);

    for (const route of routes) {
      const where = `route ${route.eventType} → ${route.templateKey}`;
      expect(isEventType(route.eventType), where).toBe(true);
      expect(isAudienceKey(route.audience), where).toBe(true);
      const provided = variablesFor(route.eventType as EventType);
      const rows = templates.filter((row) => row.key === route.templateKey);
      expect(
        rows.map((row) => row.channel),
        where
      ).toEqual(expect.arrayContaining(["email", "in_app"]));
      for (const row of rows) {
        expect(
          row.variables.filter((name) => !provided.includes(name)),
          `${where} (${row.channel})`
        ).toEqual([]);
      }
    }
  });

  it("gives every template key an email and an in-app wording that check out", async () => {
    const h = await createHarness();
    const templates = await h.db.select().from(messageTemplate);

    const keys = new Set(templates.map((row) => row.key));
    for (const key of keys) {
      const channels = templates
        .filter((row) => row.key === key)
        .map((row) => row.channel);
      expect(channels, key).toEqual(
        expect.arrayContaining(["email", "in_app"])
      );
    }
    for (const row of templates) {
      const where = `${row.key} (${row.channel})`;
      expect(checkTemplate(row.body, row.variables), where).toEqual([]);
      if (row.subject !== null) {
        expect(checkTemplate(row.subject, row.variables), where).toEqual([]);
      }
      expect(row.subject === null, where).toBe(row.channel === "sms");
    }
  });
});
