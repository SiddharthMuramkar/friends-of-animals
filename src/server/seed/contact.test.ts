import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { contactMessage, contactNote } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { SEED_ACCOUNTS } from "./accounts";

const [asha, ravi] = SEED_ACCOUNTS.members;

async function snapshot(h: Harness) {
  return {
    messages: await h.db
      .select()
      .from(contactMessage)
      .orderBy(asc(contactMessage.id)),
    notes: await h.db.select().from(contactNote).orderBy(asc(contactNote.id)),
  };
}

describe("the contact seed", () => {
  it("gives the same messages and note however often it runs", async () => {
    const h = await createHarness();

    await h.seed.preview();
    const first = await snapshot(h);
    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(await snapshot(h)).toEqual(first);
    expect(first.messages).toHaveLength(4);
    expect(first.notes).toHaveLength(1);
  });

  it("shows the staff admin a new, an assigned and noted, and two closed messages from three teams", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const admin = await h.signIn({ email: ravi.email });

    const list = await h.as(admin).listContactInbox();
    const items = list.ok ? list.items : [];
    const view = async (id: string) => {
      const result = await h.as(admin).getContactMessage({ messageId: id });
      if (!result.ok) throw new Error(`Cannot read seeded message ${id}`);
      return result.message;
    };

    expect(items.map((item) => item.status).sort()).toEqual([
      "closed",
      "closed",
      "in_progress",
      "new",
    ]);
    expect(new Set(items.map((item) => item.team)).size).toBe(3);
    const handled = await view(
      items.find((item) => item.status === "in_progress")!.id
    );
    expect(handled.assignee?.name).toBe(asha.name);
    expect(handled.notes).toEqual([
      expect.objectContaining({ author: { id: asha.id, name: asha.name } }),
    ]);
    const closed = await Promise.all(
      items.filter((item) => item.status === "closed").map((c) => view(c.id))
    );
    expect(closed.map((message) => message.closeReason).sort()).toEqual([
      "resolved",
      "spam",
    ]);
  });

  it("puts the message assigned to the content manager in her team's inbox", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const editor = await h.signIn({ email: asha.email });

    const list = await h.as(editor).listContactInbox({ assignee: "me" });

    expect(list.ok && list.items).toEqual([
      expect.objectContaining({
        team: "content_manager",
        status: "in_progress",
      }),
    ]);
  });
});
