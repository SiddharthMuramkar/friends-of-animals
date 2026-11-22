// Seam 1 for the dispatcher (#69): an emitted event, delivered by the
// outbox relay (`h.drain()`), sends the messages its route rows name.
// The welcome email from #61 now goes this way.

import { and, count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  inboxItem,
  messageDelivery,
  messageRoute,
  outbox,
} from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

const ASHA = "asha@example.test";

async function signUp(h: Harness, name: string, email: string) {
  const visitor = h.visitor();
  await h.as(visitor).requestEmailCode({ intent: "sign-up", name, email });
  const code = h.email.codeFor(email);
  if (!code) throw new Error(`No code was emailed to ${email}`);
  const result = await h.as(visitor).verifyEmailCode({
    intent: "sign-up",
    name,
    email,
    code,
  });
  if (!result.ok) throw new Error(`Sign-up failed: ${result.error}`);
  return result.userId;
}

async function contentManager(h: Harness) {
  const account = await h.seed.member();
  await h.seed.grant(account, {
    role: "content_manager",
    scope: { type: "global" },
  });
  return h.signIn(account);
}

async function inboxOf(h: Harness, userId: string) {
  return h.db.select().from(inboxItem).where(eq(inboxItem.userId, userId));
}

async function deliveryCount(h: Harness) {
  const [row] = await h.db.select({ n: count() }).from(messageDelivery);
  return row?.n;
}

function welcomesTo(h: Harness, email: string) {
  return h.email.sent.filter(
    (message) => message.to === email && !message.subject.includes("code")
  );
}

describe("dispatching an event through its routes", () => {
  it("sends the welcome email and an inbox item for a sign-up, through the route row", async () => {
    const h = await createHarness();

    const userId = await signUp(h, "Asha Rao", ASHA);
    const rows = await h.db.select().from(outbox);
    expect(rows).toEqual([
      expect.objectContaining({
        eventType: "identity.user_signed_up",
        handler: "notifications.dispatch",
      }),
    ]);
    expect(await h.drain()).toMatchObject({ dispatched: 1, failed: 0 });

    const welcome = h.email.lastTo(ASHA);
    expect(welcome?.subject).toBe("Welcome to Friends of Animals");
    expect(welcome?.text).toContain("Hello Asha Rao,");
    expect(welcome?.html).toContain("<p>Hello Asha Rao,</p>");
    expect(await inboxOf(h, userId)).toEqual([
      expect.objectContaining({
        templateKey: "identity.welcome",
        title: "Welcome to Friends of Animals",
        body: expect.stringContaining("Asha Rao"),
        readAt: null,
      }),
    ]);
    expect(h.sms.sent).toEqual([]);
  });

  it("uses a content manager's new wording for the next message", async () => {
    const h = await createHarness();
    const manager = await contentManager(h);
    await h.as(manager).updateMessageTemplate({
      key: "identity.welcome",
      channel: "email",
      subject: "Namaste, {{recipient.name}}",
      body: "Dear {{recipient.name}},\n\nWelcome to the pack.",
    });

    await signUp(h, "Asha Rao", ASHA);
    await h.drain();

    const welcome = h.email.lastTo(ASHA);
    expect(welcome?.subject).toBe("Namaste, Asha Rao");
    expect(welcome?.text).toBe("Dear Asha Rao,\n\nWelcome to the pack.");
    const [delivery] = await h.db
      .select()
      .from(messageDelivery)
      .where(eq(messageDelivery.channel, "email"));
    expect(delivery).toMatchObject({ status: "sent", templateVersion: 2 });
  });

  it("puts a subject on one line, whatever line breaks a name brings", async () => {
    const h = await createHarness();
    const manager = await contentManager(h);
    await h.as(manager).updateMessageTemplate({
      key: "identity.welcome",
      channel: "email",
      subject: "Namaste, {{recipient.name}}",
      body: "Dear {{recipient.name}},\n\nWelcome to the pack.",
    });

    await signUp(h, "Asha\r\nBcc: ravi@example.test\u2028Rao\t", ASHA);
    await h.drain();

    const welcome = h.email.lastTo(ASHA);
    expect(welcome?.subject).toBe("Namaste, Asha Bcc: ravi@example.test Rao");
    // The body is text, where a line break is only a line break.
    expect(welcome?.text).toContain("Dear Asha\r\nBcc: ravi@example.test");
  });

  it("escapes a variable's value in the email's HTML", async () => {
    const h = await createHarness();

    await signUp(h, "Asha <b>Rao</b> & co", ASHA);
    await h.drain();

    const welcome = h.email.lastTo(ASHA);
    expect(welcome?.text).toContain("Hello Asha <b>Rao</b> & co,");
    expect(welcome?.html).toContain(
      "Hello Asha &lt;b&gt;Rao&lt;/b&gt; &amp; co,"
    );
    expect(welcome?.html).not.toContain("<b>");
  });

  it("sends nothing for an event type with no route row", async () => {
    const h = await createHarness();
    await h.db
      .delete(messageRoute)
      .where(eq(messageRoute.eventType, "identity.user_signed_up"));

    const userId = await signUp(h, "Asha Rao", ASHA);
    expect(await h.drain()).toMatchObject({ dispatched: 1, failed: 0 });

    expect(welcomesTo(h, ASHA)).toEqual([]);
    expect(h.sms.sent).toEqual([]);
    expect(await inboxOf(h, userId)).toEqual([]);
    expect(await deliveryCount(h)).toBe(0);
  });

  it("sends nothing for a route that is switched off", async () => {
    const h = await createHarness();
    await h.db
      .update(messageRoute)
      .set({ enabled: false })
      .where(eq(messageRoute.eventType, "identity.user_signed_up"));

    const userId = await signUp(h, "Asha Rao", ASHA);
    await h.drain();

    expect(welcomesTo(h, ASHA)).toEqual([]);
    expect(h.sms.sent).toEqual([]);
    expect(await inboxOf(h, userId)).toEqual([]);
  });
});

describe("delivering each message once", () => {
  it("delivers once when the outbox delivers the same event again", async () => {
    const h = await createHarness();
    const userId = await signUp(h, "Asha Rao", ASHA);
    await h.drain();
    expect(await h.drain()).toMatchObject({ dispatched: 0 });

    // The relay redelivers (a worker died after the handler ran).
    await h.db
      .update(outbox)
      .set({ status: "pending", dispatchedAt: null, lockedUntil: null })
      .where(eq(outbox.aggregateId, userId));
    expect(await h.drain()).toMatchObject({ dispatched: 1, failed: 0 });

    expect(welcomesTo(h, ASHA)).toHaveLength(1);
    expect(await inboxOf(h, userId)).toHaveLength(1);
    expect(await deliveryCount(h)).toBe(2);
  });

  it("retries a failed email with the event, without a second inbox item", async () => {
    const h = await createHarness();
    const userId = await signUp(h, "Asha Rao", ASHA);
    h.email.failNext(1);

    expect(await h.drain()).toMatchObject({ dispatched: 0, retried: 1 });
    expect(welcomesTo(h, ASHA)).toEqual([]);
    const [failed] = await h.db
      .select()
      .from(messageDelivery)
      .where(
        and(
          eq(messageDelivery.userId, userId),
          eq(messageDelivery.channel, "email")
        )
      );
    expect(failed).toMatchObject({ status: "failed", attempts: 1 });

    h.clock.advance({ hours: 1 });
    expect(await h.drain()).toMatchObject({ dispatched: 1, failed: 0 });

    expect(welcomesTo(h, ASHA)).toHaveLength(1);
    expect(await inboxOf(h, userId)).toHaveLength(1);
    const [sent] = await h.db
      .select()
      .from(messageDelivery)
      .where(
        and(
          eq(messageDelivery.userId, userId),
          eq(messageDelivery.channel, "email")
        )
      );
    expect(sent).toMatchObject({ status: "sent", attempts: 2 });
  });
});
