// #115a: who hears about a request. The requester gets a receipt by email
// and in the app; every grievance officer gets an in-app note; the daily
// run gives each officer one digest of overdue requests, once a day.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { inboxItem } from "@/server/db/schema";
import { SCHEDULES } from "@/server/outbox/schedules";
import { createHarness, type Harness } from "@/test/harness";

import { memberWithRequest, signedInOfficer } from "./testing";

async function inboxOf(h: Harness, userId: string) {
  return h.db
    .select({ title: inboxItem.title, body: inboxItem.body })
    .from(inboxItem)
    .where(eq(inboxItem.userId, userId));
}

const flagOverdue = SCHEDULES.find(
  (schedule) => schedule.name === "privacy.flag_overdue"
)!;

describe("a new request's messages", () => {
  it("sends the requester a receipt and each officer a note, naming no one", async () => {
    const h = await createHarness();
    const gita = await signedInOfficer(h, { name: "Gita Officer" });
    const hari = await signedInOfficer(h, { name: "Hari Officer" });
    const filed = await memberWithRequest(h, "correction", {
      name: "Asha Rao",
      email: "asha@example.test",
    });

    await h.drain();

    const receipt = h.email.lastTo("asha@example.test");
    expect(receipt?.subject).toBe(
      `We have your privacy request ${filed.reference}`
    );
    expect(receipt?.text).toContain("a correction to the data we hold");
    expect(receipt?.text).toContain("14 February 2027");
    expect(receipt?.text).not.toContain("spell my name");
    expect(await inboxOf(h, filed.account.id)).toEqual([
      expect.objectContaining({
        title: `Privacy request ${filed.reference} received`,
      }),
    ]);
    for (const officer of [gita, hari]) {
      const inbox = await inboxOf(h, officer.id);
      expect(inbox).toEqual([
        expect.objectContaining({
          title: `New privacy request ${filed.reference}`,
        }),
      ]);
      expect(JSON.stringify(inbox)).not.toContain("Asha");
    }
  });
});

describe("the daily overdue digest", () => {
  it("gives each officer the counts once a day, and nothing when none are overdue", async () => {
    const h = await createHarness();
    const gita = await signedInOfficer(h, { name: "Gita Officer" });
    const hari = await signedInOfficer(h, { name: "Hari Officer" });
    const mine = await memberWithRequest(h, "access");
    await memberWithRequest(h, "erasure");
    await h.as(gita.actor).startPrivacyRequest({ id: mine.requestId });
    await h.drain();
    const before = {
      gita: (await inboxOf(h, gita.id)).length,
      hari: (await inboxOf(h, hari.id)).length,
    };

    // Nothing is overdue yet.
    await flagOverdue.run(h.deps);
    await h.drain();
    expect((await inboxOf(h, gita.id)).length).toBe(before.gita);

    h.clock.advance({ days: 31 });
    await flagOverdue.run(h.deps);
    await flagOverdue.run(h.deps);
    await h.drain();

    const digest = (inbox: { title: string; body: string }[]) =>
      inbox.filter((item) => item.title === "Overdue privacy requests");
    expect(digest(await inboxOf(h, gita.id))).toEqual([
      expect.objectContaining({
        body: expect.stringContaining(
          "2 privacy requests are past their due date, 1 of them assigned to you"
        ),
      }),
    ]);
    expect(digest(await inboxOf(h, hari.id))).toEqual([
      expect.objectContaining({
        body: expect.stringContaining("0 of them assigned to you"),
      }),
    ]);

    // The next day brings a new digest.
    h.clock.advance({ days: 1 });
    await flagOverdue.run(h.deps);
    await h.drain();
    expect(digest(await inboxOf(h, gita.id))).toHaveLength(2);
  });

  it("runs only as the platform's worker or command line", async () => {
    const h = await createHarness();
    const officer = await signedInOfficer(h);
    for (const actor of [officer.actor, h.visitor()]) {
      await expect(
        h.as(actor).flagOverduePrivacyRequests()
      ).rejects.toMatchObject({ name: "DomainError", code: "forbidden" });
    }
    expect(
      await h
        .as({ kind: "system", process: "cli" })
        .flagOverduePrivacyRequests()
    ).toEqual({ sent: 0 });
  });
});
