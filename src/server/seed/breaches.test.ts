import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditLog,
  breachNotification,
  breachRecord,
  breachTimelineEvent,
  outbox,
} from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { SEED_ACCOUNTS } from "./accounts";
import { SEED_BREACHES } from "./breaches";

describe("the breach log's preview seed", () => {
  it("makes one open breach and one notified and contained with 2 notices, the same the second time", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const snapshot = async () => ({
      breaches: await h.db
        .select({
          id: breachRecord.id,
          status: breachRecord.status,
          containedAt: breachRecord.containedAt,
          principalsNotifiedAt: breachRecord.principalsNotifiedAt,
          leadUserId: breachRecord.leadUserId,
        })
        .from(breachRecord)
        .orderBy(asc(breachRecord.id)),
      timeline: await h.db
        .select({ id: breachTimelineEvent.id, kind: breachTimelineEvent.kind })
        .from(breachTimelineEvent)
        .orderBy(asc(breachTimelineEvent.id)),
      notices: await h.db
        .select({
          breachId: breachNotification.breachId,
          recipientUserId: breachNotification.recipientUserId,
          channel: breachNotification.channel,
        })
        .from(breachNotification)
        .orderBy(asc(breachNotification.id)),
    });
    const first = await snapshot();

    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(await snapshot()).toEqual(first);
    expect(first.breaches).toEqual([
      expect.objectContaining({
        id: SEED_BREACHES.open.id,
        status: "open",
        containedAt: null,
        leadUserId: SEED_ACCOUNTS.members[1].id,
      }),
      expect.objectContaining({
        id: SEED_BREACHES.notified.id,
        status: "notified",
        containedAt: expect.any(Date),
        principalsNotifiedAt: expect.any(Date),
      }),
    ]);
    expect(
      new Set(first.notices.map((notice) => notice.recipientUserId)).size
    ).toBe(2);
    expect(first.notices).toHaveLength(4);
    expect(
      first.notices.every((n) => n.breachId === SEED_BREACHES.notified.id)
    ).toBe(true);
  });

  it("writes no audit entry and sends nothing", async () => {
    const h = await createHarness();
    await h.seed.preview();

    expect(
      await h.db.select().from(auditLog).where(eq(auditLog.entityType, "breach"))
    ).toEqual([]);
    expect(
      await h.db.select().from(outbox).where(eq(outbox.aggregateType, "breach"))
    ).toEqual([]);
  });

  it("opens decrypted for breach staff", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const admin = await h.signIn(
      await h.seed.superAdmin({ email: "breach-reader@example.test" })
    );

    const view = await h
      .as(admin)
      .getBreach({ breachId: SEED_BREACHES.notified.id });

    expect(view).toMatchObject({
      ok: true,
      breach: {
        impact: SEED_BREACHES.notified.impact,
        notices: { recipients: 2 },
        timeline: expect.arrayContaining([
          expect.objectContaining({
            kind: "note",
            note: SEED_BREACHES.notified.note,
          }),
        ]),
      },
    });
  });
});
