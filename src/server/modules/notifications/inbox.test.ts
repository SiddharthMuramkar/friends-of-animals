// Seam 1 for the in-app inbox (#69): a signed-in user's messages, newest
// first, an unread count and marking read. Each user sees and marks only
// their own.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { inboxItem } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { createHarness, type Harness } from "@/test/harness";

const ASHA = "asha@example.test";

/** Signs Asha up and delivers her welcome; returns her signed-in actor. */
async function signedUpAsha(h: Harness) {
  const visitor = h.visitor();
  await h.as(visitor).requestEmailCode({
    intent: "sign-up",
    name: "Asha Rao",
    email: ASHA,
  });
  const verified = await h.as(visitor).verifyEmailCode({
    intent: "sign-up",
    name: "Asha Rao",
    email: ASHA,
    code: h.email.codeFor(ASHA)!,
  });
  if (!verified.ok) throw new Error(verified.error);
  await h.drain();
  return { actor: await h.currentActor(), userId: verified.userId };
}

async function addItem(
  h: Harness,
  userId: string,
  item: { title: string; link?: string | null; minutesLater: number }
) {
  const at = new Date(h.clock.now().getTime() + item.minutesLater * 60_000);
  const id = uuidv7(at);
  await h.db.insert(inboxItem).values({
    id,
    userId,
    templateKey: "test.item",
    title: item.title,
    body: `${item.title}, in full.`,
    link: item.link ?? null,
    createdAt: at,
  });
  return id;
}

describe("listInbox and countUnread", () => {
  it("lists a delivered message as unread, newest first, and counts it", async () => {
    const h = await createHarness();
    const { actor, userId } = await signedUpAsha(h);
    await addItem(h, userId, { title: "Results are out", minutesLater: 5 });

    const items = await h.as(actor).listInbox();

    expect(items.map((item) => item.title)).toEqual([
      "Results are out",
      "Welcome to Friends of Animals",
    ]);
    expect(items[1]).toEqual({
      id: expect.any(String),
      title: "Welcome to Friends of Animals",
      body: expect.stringContaining("Asha Rao"),
      link: null,
      createdAt: h.clock.now(),
      readAt: null,
    });
    expect(await h.as(actor).countUnread()).toBe(2);
  });

  it("keeps only links to a page on this site", async () => {
    const h = await createHarness();
    const { actor, userId } = await signedUpAsha(h);
    await addItem(h, userId, {
      title: "Safe",
      link: "/competitions/monsoon-2027",
      minutesLater: 1,
    });
    await addItem(h, userId, {
      title: "Unsafe",
      link: "javascript:alert(1)",
      minutesLater: 2,
    });

    const items = await h.as(actor).listInbox();

    expect(items.find((item) => item.title === "Safe")?.link).toBe(
      "/competitions/monsoon-2027"
    );
    expect(items.find((item) => item.title === "Unsafe")?.link).toBeNull();
  });
});

describe("marking messages read", () => {
  it("marks one message read, once, and the count drops", async () => {
    const h = await createHarness();
    const { actor } = await signedUpAsha(h);
    const [welcome] = await h.as(actor).listInbox();
    const readAt = h.clock.advance({ minutes: 3 });

    expect(await h.as(actor).markInboxItemRead({ id: welcome!.id })).toEqual({
      ok: true,
    });
    h.clock.advance({ minutes: 3 });
    expect(await h.as(actor).markInboxItemRead({ id: welcome!.id })).toEqual({
      ok: true,
    });

    expect(await h.as(actor).countUnread()).toBe(0);
    const [item] = await h.as(actor).listInbox();
    expect(item?.readAt).toEqual(readAt);
  });

  it("marks every message read at once", async () => {
    const h = await createHarness();
    const { actor, userId } = await signedUpAsha(h);
    await addItem(h, userId, { title: "Results are out", minutesLater: 5 });

    expect(await h.as(actor).markAllInboxRead()).toEqual({
      ok: true,
      marked: 2,
    });

    expect(await h.as(actor).countUnread()).toBe(0);
    expect(await h.as(actor).markAllInboxRead()).toEqual({
      ok: true,
      marked: 0,
    });
  });

  it("answers not found for another user's message, and leaves it unread", async () => {
    const h = await createHarness();
    const { userId } = await signedUpAsha(h);
    const [ashas] = await h.db
      .select()
      .from(inboxItem)
      .where(eq(inboxItem.userId, userId));
    const ravi = await h.signIn(await h.seed.member({ name: "Ravi Iyer" }));

    expect(await h.as(ravi).markInboxItemRead({ id: ashas!.id })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await h.as(ravi).markInboxItemRead({ id: "not-an-id" })).toEqual({
      ok: false,
      error: "not_found",
    });
    await h.as(ravi).markAllInboxRead();

    expect(await h.as(ravi).listInbox()).toEqual([]);
    expect(await h.as(ravi).countUnread()).toBe(0);
    const [still] = await h.db
      .select()
      .from(inboxItem)
      .where(eq(inboxItem.id, ashas!.id));
    expect(still?.readAt).toBeNull();
  });
});

describe("who may use the inbox", () => {
  it("refuses a visitor", async () => {
    const h = await createHarness();
    const app = h.as(h.visitor());

    for (const call of [
      () => app.listInbox(),
      () => app.countUnread(),
      () => app.markInboxItemRead({ id: uuidv7(h.clock.now()) }),
      () => app.markAllInboxRead(),
    ]) {
      await expect(call()).rejects.toMatchObject({
        name: "DomainError",
        code: "forbidden",
      });
    }
  });
});
