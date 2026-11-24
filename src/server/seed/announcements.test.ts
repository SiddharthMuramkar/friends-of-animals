import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { announcement, outbox } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { SEED_ANNOUNCEMENTS } from "./announcements";
import { SEED_COMPETITION_MANAGER } from "./index";

// #84 AC12: the preview seed gives the open competition (NEIGH27) one
// draft and one sent announcement, sends nothing, and runs again safely.

describe("the announcements seed", () => {
  it("gives the open competition a draft and a sent announcement", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const manager = await h.signIn(SEED_COMPETITION_MANAGER);

    const listed = await h
      .as(manager)
      .listAnnouncements({ competitionId: SEED_ANNOUNCEMENTS.competitionId });

    expect(listed).toMatchObject({
      ok: true,
      competition: { code: "NEIGH27" },
      announcements: [
        {
          id: SEED_ANNOUNCEMENTS.draft.id,
          status: "draft",
          sentAt: null,
        },
        {
          id: SEED_ANNOUNCEMENTS.sent.id,
          status: "sent",
          recipientCount: expect.any(Number),
        },
      ],
    });
    // Seed data sends nothing.
    expect(
      await h.db
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, "competition.announcement_sent"))
    ).toEqual([]);
  });

  it("is safe to run again", async () => {
    const h = await createHarness();
    await h.seed.preview();

    await h.seed.preview();

    const [rows] = await h.db.select({ n: count() }).from(announcement);
    expect(rows?.n).toBe(2);
  });
});
