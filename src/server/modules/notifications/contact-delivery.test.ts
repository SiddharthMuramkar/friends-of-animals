// sendToContact (#84, F13): one route's message to contact details with no
// account. Each message goes once per event, template, contact and
// channel; a failed send goes again on the retry; an overlapping run that
// finds the message claimed leaves it alone, unless the claim is stale.

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { messageDelivery, messageTemplate } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import type { Delivery } from "@/server/outbox";
import { createHarness, type Harness } from "@/test/harness";

import {
  CONTACT_HASH_PURPOSE,
  SENDING_LEASE_MINUTES,
  sendToContact,
  type ContactMessage,
} from "./contact-delivery";

const KIRAN = "kiran@example.test";

async function message(
  h: Harness,
  overrides: Partial<ContactMessage> = {}
): Promise<ContactMessage> {
  const templates = await h.db
    .select()
    .from(messageTemplate)
    .where(eq(messageTemplate.key, "announcements.announcement"));
  const delivery = {
    id: uuidv7(h.clock.now()),
    eventId: uuidv7(h.clock.now()),
    eventType: "competition.announcement_sent",
    occurredAt: h.clock.now(),
    attempt: 1,
    payload: {
      announcementId: uuidv7(h.clock.now()),
      competitionId: uuidv7(h.clock.now()),
    },
  } satisfies Delivery<"competition.announcement_sent">;
  return {
    delivery,
    route: {
      templateKey: "announcements.announcement",
      channels: ["email", "sms", "in_app"],
      requiredByLaw: false,
    },
    templates: Object.fromEntries(templates.map((row) => [row.channel, row])),
    contactKey: `email:${KIRAN}`,
    email: KIRAN,
    phone: "+919000000303",
    values: {
      "recipient.name": "Kiran Rao",
      "competition.name": "Paws for Thought",
      "announcement.subject": "The drawing day",
      "announcement.body": "Theme\nStreet dogs",
    },
    ...overrides,
  };
}

async function rows(h: Harness) {
  return h.db
    .select({
      channel: messageDelivery.channel,
      status: messageDelivery.status,
      reason: messageDelivery.reason,
      userId: messageDelivery.userId,
      contactHash: messageDelivery.contactHash,
      attempts: messageDelivery.attempts,
    })
    .from(messageDelivery)
    .orderBy(messageDelivery.channel);
}

describe("sendToContact", () => {
  it("emails the contact once however often it runs, and keeps only a blind index of them", async () => {
    const h = await createHarness();
    const sent = await message(h);

    expect(await sendToContact(h.deps, sent, false)).toBeNull();
    expect(await sendToContact(h.deps, sent, false)).toBeNull();

    expect(h.email.sent.map((email) => [email.to, email.subject])).toEqual([
      [KIRAN, "Paws for Thought: The drawing day"],
    ]);
    const hash = h.deps.blindIndex.of(CONTACT_HASH_PURPOSE, `email:${KIRAN}`);
    // No inbox without an account; SMS is off, so email covers for it.
    expect(await rows(h)).toEqual([
      {
        channel: "email",
        status: "sent",
        reason: null,
        userId: null,
        contactHash: hash,
        attempts: 1,
      },
      {
        channel: "sms",
        status: "suppressed",
        reason: "sms_disabled",
        userId: null,
        contactHash: h.deps.blindIndex.of(
          CONTACT_HASH_PURPOSE,
          "sms:+919000000303"
        ),
        attempts: 0,
      },
    ]);
  });

  it("sends a failed email again on the retry, once", async () => {
    const h = await createHarness();
    const sent = await message(h);
    h.email.failNext(1, new Error("SES is down"));

    const failed = await sendToContact(h.deps, sent, false);
    const retried = await sendToContact(h.deps, sent, false);
    await sendToContact(h.deps, sent, false);

    expect(failed).toEqual(new Error("SES is down"));
    expect(retried).toBeNull();
    expect(h.email.sent).toHaveLength(1);
    expect(await rows(h)).toContainEqual(
      expect.objectContaining({ channel: "email", status: "sent", attempts: 2 })
    );
  });

  it("emails independent addresses sharing a phone when no identity alias was supplied", async () => {
    const h = await createHarness();
    const first = await message(h);
    const second = {
      ...first,
      email: "sana@example.test",
      contactKey: "email:sana@example.test",
    };

    await sendToContact(h.deps, first, false);
    await sendToContact(h.deps, second, false);

    expect(h.email.sent.map((email) => email.to)).toEqual([
      KIRAN,
      "sana@example.test",
    ]);
  });

  it("leaves a message another run has claimed, and takes over a stale claim", async () => {
    const h = await createHarness();
    const sent = await message(h);
    const now = h.clock.now();
    await h.db.insert(messageDelivery).values({
      id: uuidv7(now),
      eventId: sent.delivery.eventId,
      templateKey: "announcements.announcement",
      contactHash: h.deps.blindIndex.of(CONTACT_HASH_PURPOSE, sent.contactKey),
      channel: "email",
      status: "sending",
      attempts: 1,
      createdAt: now,
      updatedAt: now,
    });

    const busy = await sendToContact(h.deps, sent, false);
    expect(busy).toBeInstanceOf(Error);
    expect(String(busy)).not.toContain(KIRAN);
    expect(h.email.sent).toEqual([]);

    h.clock.advance({ minutes: SENDING_LEASE_MINUTES + 1 });
    expect(await sendToContact(h.deps, sent, false)).toBeNull();
    expect(h.email.sent.map((email) => email.to)).toEqual([KIRAN]);
  });

  it("waits for an overlapping claim on the same contact after the email changes", async () => {
    const h = await createHarness();
    const original = await message(h, {
      contactAliases: ['guardian-phone:["+919000000303","kiran rao"]'],
    });
    const next = {
      ...original,
      email: "kiran-new@example.test",
      contactKey: "email:kiran-new@example.test",
    };
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const deps = {
      ...h.deps,
      email: {
        async send(mail: Parameters<typeof h.email.send>[0]) {
          started.resolve();
          await release.promise;
          await h.email.send(mail);
        },
      },
    };
    const first = sendToContact(deps, original, false);
    try {
      await Promise.race([started.promise, first]);
      expect(await sendToContact(h.deps, next, false)).toBeInstanceOf(Error);
    } finally {
      release.resolve();
      await first;
    }
    expect(await sendToContact(h.deps, next, false)).toBeNull();
    expect(h.email.sent.map((email) => email.to)).toEqual([KIRAN]);
  });

  it("texts a contact with a phone once SMS is on and the wording is registered", async () => {
    const h = await createHarness();
    await h.db
      .update(messageTemplate)
      .set({ dltTemplateId: "1107170000000000084" })
      .where(
        and(
          eq(messageTemplate.key, "announcements.announcement"),
          eq(messageTemplate.channel, "sms")
        )
      );

    await sendToContact(h.deps, await message(h), true);

    expect(h.sms.sent.map((sms) => [sms.to, sms.dltTemplateId])).toEqual([
      ["+919000000303", "1107170000000000084"],
    ]);
    expect(h.email.sent.map((email) => email.to)).toEqual([KIRAN]);
  });

  it("records a contact with no address as unreachable on email", async () => {
    const h = await createHarness();

    await sendToContact(
      h.deps,
      await message(h, { email: null, phone: null, contactKey: "phone:x" }),
      false
    );

    expect(h.email.sent).toEqual([]);
    expect(await rows(h)).toContainEqual(
      expect.objectContaining({
        channel: "email",
        status: "suppressed",
        reason: "no_contact",
      })
    );
  });
});
