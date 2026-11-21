import { and, asc, count, eq, isNotNull, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  inboxItem,
  messageRoute,
  messageTemplate,
  notificationPreference,
} from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { SEED_ACCOUNTS } from "./accounts";

async function snapshot(h: Harness) {
  return {
    templates: await h.db
      .select()
      .from(messageTemplate)
      .orderBy(asc(messageTemplate.key), asc(messageTemplate.channel)),
    routes: await h.db
      .select()
      .from(messageRoute)
      .orderBy(asc(messageRoute.eventType)),
    preferences: await h.db
      .select()
      .from(notificationPreference)
      .orderBy(asc(notificationPreference.userId)),
    inbox: await h.db.select().from(inboxItem).orderBy(asc(inboxItem.id)),
  };
}

async function countItems(h: Harness, userId: string, read: "read" | "unread") {
  const [row] = await h.db
    .select({ n: count() })
    .from(inboxItem)
    .where(
      and(
        eq(inboxItem.userId, userId),
        read === "read" ? isNotNull(inboxItem.readAt) : isNull(inboxItem.readAt)
      )
    );
  return row?.n ?? 0;
}

describe("the notifications seed", () => {
  it("gives the same templates, routes, preferences and inbox rows however often it runs", async () => {
    const h = await createHarness();

    await h.seed.preview();
    const first = await snapshot(h);
    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(await snapshot(h)).toEqual(first);
    expect(first.templates.length).toBeGreaterThan(0);
    expect(first.routes.length).toBeGreaterThan(0);
    expect(first.preferences.length).toBeGreaterThan(0);
  });

  it("gives every seeded member at least one unread and one read inbox item", async () => {
    const h = await createHarness();

    await h.seed.preview();

    for (const member of SEED_ACCOUNTS.members) {
      expect(
        await countItems(h, member.id, "unread"),
        member.name
      ).toBeGreaterThan(0);
      expect(
        await countItems(h, member.id, "read"),
        member.name
      ).toBeGreaterThan(0);
    }
  });

  it("keeps an item a member marked read on the preview", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const asha = SEED_ACCOUNTS.members[0];
    await h.db
      .update(inboxItem)
      .set({ readAt: h.clock.now() })
      .where(eq(inboxItem.userId, asha.id));

    await h.seed.preview();

    expect(await countItems(h, asha.id, "unread")).toBe(0);
  });
});
