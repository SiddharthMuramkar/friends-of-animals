// The withdrawal receipt (#69) says "You withdrew your consent to
// messages": it answers a person's own messages consent only. Once
// guardian purposes exist (#82), consent.withdrawn also carries a child's
// purposes, which the receipt must not answer.
import { describe, expect, it } from "vitest";

import { outbox } from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import {
  consentCompetition,
  guardianWithChild,
} from "@/server/modules/consent/testing";
import { emit } from "@/server/outbox";
import { createHarness, type Harness } from "@/test/harness";

const RECEIPT = "You withdrew your consent to messages";

function receiptsTo(h: Harness, email: string) {
  return h.email.sent.filter(
    (message) => message.to === email && message.subject === RECEIPT
  );
}

/** A consent.withdrawn about a user's own consent to `purpose`. */
async function withdrawnByUser(
  h: Harness,
  userId: string,
  purpose: "messages" | "communications"
) {
  const id = uuidv7(h.clock.now());
  await emit(h.db, h.clock, {
    type: "consent.withdrawn",
    aggregate: { type: "consent_event", id },
    payload: {
      consentEventId: id,
      subjectType: "user",
      subjectId: userId,
      purpose,
      documentId: uuidv7(h.clock.now()),
      competitionId: null,
    },
  });
  await h.drain();
}

describe("the messages withdrawal receipt", () => {
  it("answers a person withdrawing their own messages consent", async () => {
    const h = await createHarness();
    const member = await h.seed.member({ name: "Asha Rao" });

    await withdrawnByUser(h, member.id, "messages");

    expect(receiptsTo(h, member.email)).toHaveLength(1);
  });

  it("answers no other purpose, even a user's", async () => {
    const h = await createHarness();
    const member = await h.seed.member({ name: "Asha Rao" });

    await withdrawnByUser(h, member.id, "communications");

    expect(receiptsTo(h, member.email)).toEqual([]);
  });

  it("still dispatches a messages withdrawal recorded before competition scope existed", async () => {
    const h = await createHarness();
    const member = await h.seed.member();
    const now = h.clock.now();
    const consentEventId = uuidv7(now);
    await h.db.insert(outbox).values({
      id: uuidv7(now),
      eventId: uuidv7(now),
      eventType: "consent.withdrawn",
      aggregateType: "consent_event",
      aggregateId: consentEventId,
      handler: "notifications.dispatch",
      payload: {
        consentEventId,
        subjectType: "user",
        subjectId: member.id,
        purpose: "messages",
        documentId: uuidv7(now),
      },
      occurredAt: now,
      availableAt: now,
    });

    await h.drain();

    expect(receiptsTo(h, member.email)).toHaveLength(1);
    expect(
      await h.db.select({ status: outbox.status }).from(outbox)
    ).toContainEqual({ status: "dispatched" });
  });

  it("isn't sent when a guardian withdraws a child's consent", async () => {
    const h = await createHarness();
    const competition = await consentCompetition(h);
    const child = await guardianWithChild(h, competition);
    await h.as(child.actor).giveChildConsent({
      childId: child.childId,
      competitionId: competition.id,
      purpose: "public_display",
      documentId: competition.guardianDocuments.public_display!,
    });

    await h.as(child.actor).withdrawChildConsent({
      childId: child.childId,
      competitionId: competition.id,
      purpose: "public_display",
    });
    await h.drain();

    expect(h.email.sent.filter((m) => m.subject === RECEIPT)).toEqual([]);
  });
});
