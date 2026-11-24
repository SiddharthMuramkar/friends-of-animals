import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { createApp } from "@/server/app";
import * as schema from "@/server/db/schema";
import {
  guardian,
  guardianLink,
  inboxItem,
  messageDelivery,
  messageRoute,
  notificationPreference,
  outbox,
  participantProfile,
  user,
} from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { drainOutbox, emit } from "@/server/outbox";
import { createHarness, type Harness } from "@/test/harness";

import {
  breachAudit,
  noticeHarness,
  recordedBreach,
  setBreachNoticeRoute,
  staffActor,
  storedBreach,
  timelineKinds,
  noticeRows,
} from "./testing";

// #116 AC4: a breach can notify the people it affected through the
// notification port (#69). Adults are told directly; a child never is:
// their active guardians are, whether the child has a teen login or is a
// profile a guardian manages. Notices are required by law, so a recipient's
// choice of no optional email doesn't stop them. They say nothing of the
// breach's title or impact.

const NOTICE_SUBJECT = "About a personal data breach at Friends of Animals";
const TITLE_WORDS = "wrong school";
const IMPACT_WORDS = "three entrants";
const PRINCIPAL_NOTICE = "breach.principal_notice";

function breachEvents(h: Harness, breachId: string, eventType: string) {
  return h.db
    .select()
    .from(outbox)
    .where(
      and(eq(outbox.aggregateId, breachId), eq(outbox.eventType, eventType))
    );
}

async function startPagedFanOut(
  h: Harness,
  actor: Actor,
  breachId: string,
  pageSize: number
) {
  await expect(
    h.as(actor).notifyAffectedUsers({ breachId, subjects: "all_users" })
  ).resolves.toMatchObject({ ok: true, fanOut: true });
  const [first] = await breachEvents(h, breachId, "breach.fan_out_requested");
  if (!first) throw new Error("The fan-out request queued no event");
  await h.db
    .update(outbox)
    .set({ payload: { ...first.payload, pageSize } })
    .where(eq(outbox.id, first.id));
  return first.id;
}

/** The breach notices emailed, leaving out sign-in codes. */
function notices(h: Harness) {
  return h.email.sent.filter((message) => message.subject === NOTICE_SUBJECT);
}

/** Turns optional email off for `userId`, as the preferences page would. */
async function optOutOfEmail(h: Harness, userId: string) {
  await h.db
    .insert(notificationPreference)
    .values({ userId, email: false, sms: true, updatedAt: h.clock.now() });
}

async function inboxTitles(h: Harness, userId: string) {
  const rows = await h.db
    .select({ title: inboxItem.title, body: inboxItem.body })
    .from(inboxItem)
    .where(eq(inboxItem.userId, userId));
  return rows;
}

/**
 * The three people of the issue's test plan: an adult member, a 15-year-old
 * with an own login and a verified guardian, and a 9-year-old whose profile
 * another guardian manages. All three adults turned optional email off.
 */
async function family(h: Harness) {
  const adult = await h.seed.member({
    name: "Meera Iyer",
    email: "meera@example.test",
  });
  const teen = await h.seed.member({
    name: "Rohan Desai",
    email: "rohan@example.test",
  });
  const teenParent = await h.seed.guardian({
    name: "Kavita Desai",
    email: "kavita@example.test",
    children: [{ fullName: "Rohan Desai", age: 15, loginUserId: teen.id }],
  });
  const childParent = await h.seed.guardian({
    name: "Arjun Nair",
    email: "arjun@example.test",
    children: [{ fullName: "Isha Nair", age: 9 }],
  });
  for (const id of [adult.id, teenParent.account.id, childParent.account.id]) {
    await optOutOfEmail(h, id);
  }
  return {
    adult,
    teen,
    teenParent,
    childParent,
    childProfileId: childParent.childIds[0]!,
    subjects: [
      { type: "user", id: adult.id },
      { type: "user", id: teen.id },
      { type: "participant_profile", id: childParent.childIds[0]! },
    ] as const,
  };
}

describe("notifyAffectedUsers", () => {
  it("batches notice and outbox inserts for a targeted submission", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    const accounts = await Promise.all(
      Array.from({ length: 4 }, () => h.seed.member())
    );
    const statements: string[] = [];
    const db = drizzle({
      client: h.db.$client,
      schema,
      logger: { logQuery: (statement) => statements.push(statement) },
    });
    const staff = createApp({ ...h.deps, db }).as(admin);
    expect(
      await staff.notifyAffectedUsers({
        breachId,
        subjects: accounts.map(({ id }) => ({ type: "user", id })),
      })
    ).toMatchObject({ ok: true, noticesQueued: 4 });
    for (const table of ["breach_notification", "outbox"]) {
      expect(
        statements.filter((statement) =>
          statement.startsWith(`insert into "${table}"`)
        )
      ).toHaveLength(1);
    }
    expect(await noticeRows(h, breachId)).toHaveLength(8);
    expect(await breachEvents(h, breachId, PRINCIPAL_NOTICE)).toHaveLength(4);
  });

  it("routes a queued notice to the affected account after they turn eighteen", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const staff = h.as(admin);
    const breachId = await recordedBreach(h, admin);
    const teen = await h.seed.member();
    const parent = await h.seed.guardian({
      children: [
        { fullName: "Rohan Desai", age: 17, loginUserId: teen.id },
        { fullName: "Isha Desai", age: 17 },
      ],
    });
    const input = {
      breachId,
      subjects: [
        { type: "user", id: teen.id },
        { type: "participant_profile", id: parent.childIds[1]! },
      ],
    };
    await expect(staff.notifyAffectedUsers(input)).resolves.toMatchObject({
      ok: true,
      noticesQueued: 1,
    });
    h.clock.advance({ days: 370 });
    await h.drain();
    await h.drain();
    expect(notices(h).map(({ to }) => to)).toEqual([teen.email]);
    expect(await inboxTitles(h, teen.id)).toHaveLength(1);
    expect(await inboxTitles(h, parent.account.id)).toEqual([]);
    expect(await staff.getBreach({ breachId })).toMatchObject({
      ok: true,
      breach: { unreachable: { total: 1, noAccount: 1 } },
    });
  });

  it.each([true, false])(
    "replans a queued account after a teen profile is linked (verified guardian: %s)",
    async (verified) => {
      const h = await noticeHarness(PRINCIPAL_NOTICE);
      const admin = await staffActor(h, "staff_admin");
      const staff = h.as(admin);
      const breachId = await recordedBreach(h, admin);
      const teen = await h.seed.member();
      const parent = await h.seed.guardian({
        children: [{ fullName: "Rohan Desai", age: 15 }],
      });
      await expect(
        staff.notifyAffectedUsers({
          breachId,
          subjects: [{ type: "user", id: teen.id }],
        })
      ).resolves.toMatchObject({ ok: true, noticesQueued: 1 });
      if (!verified) {
        await h.db
          .update(guardian)
          .set({ verifiedAt: null, verificationMethod: null })
          .where(eq(guardian.userId, parent.account.id));
      }
      await h.db
        .update(participantProfile)
        .set({ loginUserId: teen.id })
        .where(eq(participantProfile.id, parent.childIds[0]!));

      await h.drain();
      await h.drain();
      expect(notices(h).map(({ to }) => to)).toEqual(
        verified ? [parent.account.email] : []
      );
      expect(await inboxTitles(h, teen.id)).toEqual([]);
      expect(await inboxTitles(h, parent.account.id)).toHaveLength(
        verified ? 1 : 0
      );
      expect(await staff.getBreach({ breachId })).toMatchObject({
        ok: true,
        breach: {
          notices: { recipients: verified ? 1 : 0, pending: 0 },
          unreachable: {
            total: verified ? 0 : 1,
            noGuardian: verified ? 0 : 1,
          },
        },
      });
    }
  );

  it("retries an existing principal event after closure without starting a new notice", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const staff = h.as(admin);
    const breachId = await recordedBreach(h, admin);
    const member = await h.seed.member();
    await staff.notifyAuthority({
      breachId,
      manualReference: "Example filing",
    });
    await staff.containBreach({ breachId });
    const request = { breachId, subjects: [{ type: "user", id: member.id }] };
    await expect(staff.notifyAffectedUsers(request)).resolves.toMatchObject({
      ok: true,
      noticesQueued: 1,
    });
    await expect(staff.closeBreach({ breachId })).resolves.toEqual({
      ok: true,
      status: "closed",
    });
    const [original] = await breachEvents(h, breachId, PRINCIPAL_NOTICE);
    for (const seconds of [0, 30, 60, 120, 240]) {
      h.clock.advance({ seconds });
      await h.drain();
    }
    expect(await staff.getBreach({ breachId })).toMatchObject({
      ok: true,
      breach: { status: "closed", canRetryPrincipalNotices: true },
    });
    await expect(staff.notifyAffectedUsers(request)).resolves.toEqual({
      ok: false,
      error: "breach_closed",
    });
    await setBreachNoticeRoute(h, PRINCIPAL_NOTICE, true);
    await expect(
      staff.notifyAffectedUsers({ breachId, subjects: "retry_pending" })
    ).resolves.toMatchObject({ ok: true, noticesQueued: 0 });
    await h.drain();
    await h.drain();
    expect(notices(h).map(({ to }) => to)).toEqual([member.email]);
    expect(await inboxTitles(h, member.id)).toHaveLength(1);
    expect(await breachEvents(h, breachId, PRINCIPAL_NOTICE)).toMatchObject([
      { id: original!.id, status: "dispatched" },
    ]);
    expect(await staff.getBreach({ breachId })).toMatchObject({
      ok: true,
      breach: {
        status: "closed",
        canRetryPrincipalNotices: false,
        principalsNotifiedAt: h.clock.now(),
        notices: { recipients: 1, pending: 0 },
      },
    });
  });

  it("tells the adult and both children's guardians, never the teen, even with optional email off", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    const people = await family(h);

    const result = await h
      .as(admin)
      .notifyAffectedUsers({ breachId, subjects: [...people.subjects] });
    await h.drain();

    expect(result).toEqual({
      ok: true,
      noticesQueued: 3,
      unreachable: [],
      unmatchedEmails: [],
      fanOut: false,
    });
    expect(
      notices(h)
        .map((message) => message.to)
        .sort()
    ).toEqual([
      "arjun@example.test",
      "kavita@example.test",
      "meera@example.test",
    ]);
    const toAdult = notices(h).find((m) => m.to === "meera@example.test");
    const toGuardian = notices(h).find((m) => m.to === "arjun@example.test");
    expect(toAdult?.text).toContain("Hello Meera Iyer");
    expect(toAdult?.text).toContain("your personal data");
    expect(toGuardian?.text).toContain("a child you look after");
    expect(
      h.email.sent.some(
        (m) => m.to === "rohan@example.test" && m.subject === NOTICE_SUBJECT
      )
    ).toBe(false);
    for (const id of [
      people.adult.id,
      people.teenParent.account.id,
      people.childParent.account.id,
    ]) {
      expect(await inboxTitles(h, id)).toEqual([
        expect.objectContaining({
          title: "A personal data breach at Friends of Animals",
        }),
      ]);
    }
    expect(await inboxTitles(h, people.teen.id)).toEqual([]);

    expect(await noticeRows(h, breachId)).toEqual(
      [
        [people.adult.id, "principal"],
        [people.teenParent.account.id, "guardian"],
        [people.childParent.account.id, "guardian"],
      ]
        .flatMap(([recipientUserId, recipientRole]) =>
          (["email", "in_app"] as const).map((channel) => ({
            recipientUserId,
            channel,
            recipientRole,
            aboutCount: 1,
          }))
        )
        .sort((a, b) =>
          `${a.recipientUserId}${a.channel}` <
          `${b.recipientUserId}${b.channel}`
            ? -1
            : 1
        )
    );
    expect(await storedBreach(h, breachId)).toMatchObject({
      status: "notified",
      principalsNotifiedAt: h.clock.now(),
    });
    expect(await timelineKinds(h, breachId)).toEqual([
      "recorded",
      "principals_notified",
    ]);
    const audit = await breachAudit(h, breachId);
    expect(
      audit.filter(({ action }) => action === "breach.principals_notified")
    ).toMatchObject([
      {
        action: "breach.principals_notified",
        before: { status: "open" },
        after: {
          status: "notified",
          principalsNotifiedAt: h.clock.now().toISOString(),
          noticesSent: 1,
        },
      },
    ]);
    expect(
      audit.filter(
        ({ action }) => action === "breach.principal_notice_delivered"
      )
    ).toMatchObject([
      { after: { noticesSent: 1 } },
      { after: { noticesSent: 1 } },
    ]);
    expect(await h.as(admin).getBreach({ breachId })).toMatchObject({
      ok: true,
      breach: { notices: { recipients: 3, pending: 0 } },
    });
  });

  it("carries nothing of the breach's title or impact to anyone", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    const people = await family(h);

    await h
      .as(admin)
      .notifyAffectedUsers({ breachId, subjects: [...people.subjects] });
    await h.drain();

    const sent = JSON.stringify([
      notices(h),
      await h.db.select().from(inboxItem),
      await h.db.select({ payload: outbox.payload }).from(outbox),
    ]);
    expect(sent).not.toContain(TITLE_WORDS);
    expect(sent).not.toContain(IMPACT_WORDS);
  });

  it("tells a guardian once about two of their children", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    const parent = await h.seed.guardian({
      name: "Kavita Desai",
      email: "kavita@example.test",
      children: [
        { fullName: "Isha Desai", age: 8 },
        { fullName: "Dev Desai", age: 11 },
      ],
    });

    const result = await h.as(admin).notifyAffectedUsers({
      breachId,
      subjects: parent.childIds.map((id) => ({
        type: "participant_profile",
        id,
      })),
    });
    await h.drain();

    expect(result).toMatchObject({ ok: true, noticesQueued: 1 });
    expect(notices(h)).toHaveLength(1);
    expect(notices(h)[0]?.text).toContain("2 children you look after");
  });

  it.each([false, true])(
    "combines separately submitted siblings on pending channels (inbox delivered: %s)",
    async (inboxDelivered) => {
      const h = await noticeHarness(PRINCIPAL_NOTICE);
      const admin = await staffActor(h, "super_admin");
      const staff = h.as(admin);
      const breachId = await recordedBreach(h, admin);
      const parent = await h.seed.guardian({
        children: [
          { fullName: "Isha Desai", age: 8 },
          { fullName: "Dev Desai", age: 11 },
        ],
      });
      const [first, second] = parent.childIds;
      const notifyChild = (id: string) =>
        staff.notifyAffectedUsers({
          breachId,
          subjects: [{ type: "participant_profile", id }],
        });
      await expect(notifyChild(first!)).resolves.toMatchObject({
        ok: true,
        noticesQueued: 1,
      });
      const [original] = await breachEvents(h, breachId, PRINCIPAL_NOTICE);
      if (inboxDelivered) {
        h.email.failNext(1);
        await h.drain();
        expect(notices(h)).toEqual([]);
        expect(await inboxTitles(h, parent.account.id)).toHaveLength(1);
      }
      const originalAudit = await breachAudit(h, breachId);
      await expect(notifyChild(second!)).resolves.toMatchObject({
        ok: true,
        noticesQueued: 0,
      });
      await expect(notifyChild(first!)).resolves.toMatchObject({
        ok: true,
        noticesQueued: 0,
      });
      h.clock.advance({ seconds: 30 });
      await h.drain();
      await h.drain();

      expect(await breachEvents(h, breachId, PRINCIPAL_NOTICE)).toMatchObject([
        { id: original!.id, status: "dispatched" },
      ]);
      expect(notices(h)).toEqual([
        expect.objectContaining({
          to: parent.account.email,
          text: expect.stringContaining("2 children you look after"),
        }),
      ]);
      expect(await inboxTitles(h, parent.account.id)).toEqual([
        expect.objectContaining({
          body: expect.stringContaining(
            inboxDelivered
              ? "a child you look after"
              : "2 children you look after"
          ),
        }),
      ]);
      expect(await noticeRows(h, breachId)).toEqual([
        {
          recipientUserId: parent.account.id,
          channel: "email",
          recipientRole: "guardian",
          aboutCount: 2,
        },
        {
          recipientUserId: parent.account.id,
          channel: "in_app",
          recipientRole: "guardian",
          aboutCount: inboxDelivered ? 1 : 2,
        },
      ]);
      expect(await timelineKinds(h, breachId)).toEqual([
        "recorded",
        "principals_notified",
      ]);
      const audit = await breachAudit(h, breachId);
      expect(audit.slice(0, originalAudit.length)).toEqual(originalAudit);
      expect(audit.slice(originalAudit.length)).toMatchObject([
        { action: "breach.principal_notice_scope_updated" },
        ...(inboxDelivered ? [] : [{ action: "breach.principals_notified" }]),
      ]);
      expect(JSON.stringify(audit)).not.toContain(second);
    }
  );

  it("counts a teen's profile and account as one child", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    const { teen, teenParent } = await family(h);

    await expect(
      h.as(admin).notifyAffectedUsers({
        breachId,
        subjects: [
          { type: "participant_profile", id: teenParent.childIds[0]! },
          { type: "user", id: teen.id },
        ],
      })
    ).resolves.toMatchObject({ ok: true, noticesQueued: 1 });
    await h.drain();

    expect(await noticeRows(h, breachId)).toEqual(
      ["email", "in_app"].map((channel) => ({
        recipientUserId: teenParent.account.id,
        channel,
        recipientRole: "guardian",
        aboutCount: 1,
      }))
    );
    expect(notices(h)).toEqual([
      expect.objectContaining({
        to: teenParent.account.email,
        text: expect.stringContaining("a child you look after"),
      }),
    ]);
    expect(await inboxTitles(h, teenParent.account.id)).toEqual([
      expect.objectContaining({
        body: expect.stringContaining("a child you look after"),
      }),
    ]);
  });

  it("keeps an independent notice when a guardian link ends before delivery", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    const { teen, teenParent, childParent, childProfileId } = await family(h);
    await expect(
      h.as(admin).notifyAffectedUsers({
        breachId,
        subjects: [
          { type: "user", id: teen.id },
          { type: "user", id: teenParent.account.id },
          { type: "participant_profile", id: childProfileId },
        ],
      })
    ).resolves.toMatchObject({ ok: true, noticesQueued: 2 });

    await h.db
      .update(guardianLink)
      .set({ revokedAt: h.clock.now() })
      .where(eq(guardianLink.participantProfileId, teenParent.childIds[0]!));
    await h.db
      .update(guardian)
      .set({ verifiedAt: null, verificationMethod: null })
      .where(eq(guardian.userId, childParent.account.id));
    await h.drain();

    expect(notices(h)).toEqual([
      expect.objectContaining({
        to: teenParent.account.email,
        text: expect.stringContaining("involved your personal data."),
      }),
    ]);
    expect(await inboxTitles(h, teenParent.account.id)).toEqual([
      expect.objectContaining({
        body: expect.stringContaining("involved your personal data."),
      }),
    ]);
    expect(await inboxTitles(h, childParent.account.id)).toEqual([]);
    expect(await inboxTitles(h, teen.id)).toEqual([]);
    const deliveries = await h.db
      .select()
      .from(messageDelivery)
      .where(
        and(
          eq(messageDelivery.userId, childParent.account.id),
          eq(messageDelivery.templateKey, PRINCIPAL_NOTICE)
        )
      );
    expect(deliveries).toHaveLength(2);
    expect(deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "email",
          status: "suppressed",
          reason: "no_guardian",
        }),
        expect.objectContaining({
          channel: "in_app",
          status: "suppressed",
          reason: "no_guardian",
        }),
      ])
    );
    expect(await h.as(admin).getBreach({ breachId })).toMatchObject({
      ok: true,
      breach: {
        notices: { recipients: 1 },
        unreachable: { total: 2, noGuardian: 2 },
      },
    });
  });

  it("rechecks a pending email independently of a delivered inbox notice", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    const parent = await h.seed.guardian({
      children: [{ fullName: "Isha Desai", age: 8 }],
    });
    const childId = parent.childIds[0]!;
    await h.as(admin).notifyAffectedUsers({
      breachId,
      subjects: [
        { type: "user", id: parent.account.id },
        { type: "participant_profile", id: childId },
      ],
    });
    h.email.failNext(1);
    await h.drain();
    expect(notices(h)).toEqual([]);
    const inbox = await inboxTitles(h, parent.account.id);
    expect(inbox).toEqual([
      expect.objectContaining({
        body: expect.stringContaining("a child you look after"),
      }),
    ]);

    await h.db
      .update(guardianLink)
      .set({ revokedAt: h.clock.now() })
      .where(eq(guardianLink.participantProfileId, childId));
    h.clock.advance({ seconds: 30 });
    await h.drain();

    expect(notices(h)).toEqual([
      expect.objectContaining({
        text: expect.stringContaining("involved your personal data."),
      }),
    ]);
    expect(await inboxTitles(h, parent.account.id)).toEqual(inbox);
    expect(await h.as(admin).getBreach({ breachId })).toMatchObject({
      ok: true,
      breach: { notices: { recipients: 1 } },
    });
  });

  it("holds required notices with routing off and resumes the original event after enabling it", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    const member = await h.seed.member();
    const staff = h.as(admin);
    await staff.containBreach({ breachId });
    const request = { breachId, subjects: [{ type: "user", id: member.id }] };
    await expect(
      h.as(admin).notifyAffectedUsers(request)
    ).resolves.toMatchObject({ ok: true, noticesQueued: 1 });
    const [event] = await breachEvents(h, breachId, PRINCIPAL_NOTICE);

    await h.drain();
    expect(notices(h)).toEqual([]);
    expect(await inboxTitles(h, member.id)).toEqual([]);
    expect.soft(await staff.getBreach({ breachId })).toMatchObject({
      ok: true,
      breach: {
        status: "contained",
        principalsNotifiedAt: null,
        notices: { recipients: 0, pending: 1 },
      },
    });
    expect
      .soft((await breachAudit(h, breachId)).map(({ action }) => action))
      .not.toContain("breach.principals_notified");
    expect.soft(await staff.closeBreach({ breachId })).toEqual({
      ok: false,
      error: "reason_required",
    });
    expect
      .soft(await staff.closeBreach({ breachId, reason: "No notice needed" }))
      .toEqual({ ok: false, error: "principal_notices_pending" });
    expect(await breachEvents(h, breachId, PRINCIPAL_NOTICE)).toMatchObject([
      { id: event!.id, status: "pending", attempts: 1 },
    ]);
    for (const seconds of [30, 60, 120, 240]) {
      h.clock.advance({ seconds });
      await h.drain();
    }
    expect(await breachEvents(h, breachId, PRINCIPAL_NOTICE)).toMatchObject([
      { id: event!.id, status: "failed", attempts: 5 },
    ]);
    expect(await staff.getBreach({ breachId })).toMatchObject({
      ok: true,
      breach: { canRetryPrincipalNotices: true },
    });

    await setBreachNoticeRoute(h, PRINCIPAL_NOTICE, true);
    const auditBeforeRetry = await breachAudit(h, breachId);
    await expect(
      h.as(admin).notifyAffectedUsers(request)
    ).resolves.toMatchObject({ ok: true, noticesQueued: 0 });
    const auditAfterRetry = await breachAudit(h, breachId);
    expect.soft(auditAfterRetry.slice(auditBeforeRetry.length)).toMatchObject([
      {
        action: "breach.principal_notices_requeued",
        after: { eventsRequeued: 1 },
      },
    ]);
    await expect(staff.notifyAffectedUsers(request)).resolves.toMatchObject({
      ok: true,
      noticesQueued: 0,
    });
    expect(await breachAudit(h, breachId)).toEqual(auditAfterRetry);
    await h.drain();
    await h.drain();

    expect(notices(h).map(({ to }) => to)).toEqual([member.email]);
    expect(await inboxTitles(h, member.id)).toHaveLength(1);
    expect(await breachEvents(h, breachId, PRINCIPAL_NOTICE)).toMatchObject([
      { id: event!.id, status: "dispatched" },
    ]);
    expect(await timelineKinds(h, breachId)).toEqual([
      "recorded",
      "contained",
      "principals_notified",
    ]);
    expect(await storedBreach(h, breachId)).toMatchObject({
      status: "notified",
      principalsNotifiedAt: h.clock.now(),
    });
  });

  it("keeps the principal notice within its own audience when a team route exists", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    const member = await h.seed.member();
    const finance = await h.seed.member();
    await h.seed.grant(finance, { role: "finance", scope: { type: "global" } });
    await h.db.insert(messageRoute).values({
      eventType: PRINCIPAL_NOTICE,
      templateKey: PRINCIPAL_NOTICE,
      audience: "finance_team",
      channels: ["email", "in_app"],
      createdAt: h.clock.now(),
    });

    await h.as(admin).notifyAffectedUsers({
      breachId,
      subjects: [{ type: "user", id: member.id }],
    });
    await h.drain();

    expect(notices(h).map(({ to }) => to)).toEqual([member.email]);
    expect(await inboxTitles(h, member.id)).toHaveLength(1);
    expect(await inboxTitles(h, finance.id)).toEqual([]);
  });

  it("starts with both real breach notice routes disabled after migration", async () => {
    const h = await createHarness();
    for (const event of [PRINCIPAL_NOTICE, "breach.authority_notice"]) {
      const routes = await h.db
        .select({ enabled: messageRoute.enabled })
        .from(messageRoute)
        .where(eq(messageRoute.eventType, event));
      expect(routes).toEqual([{ enabled: false }]);
    }
    expect(await h.settings.get("breach.authorityEmail")).toBe("");
  });

  it("sends nothing new on a replay or a second drain, and one notice for one new person", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    const people = await family(h);
    await h
      .as(admin)
      .notifyAffectedUsers({ breachId, subjects: [...people.subjects] });
    await h.drain();
    const rows = await noticeRows(h, breachId);
    const audit = await breachAudit(h, breachId);

    const replay = await h
      .as(admin)
      .notifyAffectedUsers({ breachId, subjects: [...people.subjects] });
    await h.drain();
    await h.drain();

    expect(replay).toMatchObject({ ok: true, noticesQueued: 0 });
    expect(notices(h)).toHaveLength(3);
    expect(await noticeRows(h, breachId)).toEqual(rows);
    expect(await breachAudit(h, breachId)).toEqual(audit);
    expect(await timelineKinds(h, breachId)).toEqual([
      "recorded",
      "principals_notified",
    ]);

    const late = await h.seed.member({
      name: "Sana Khan",
      email: "sana@example.test",
    });
    const more = await h.as(admin).notifyAffectedUsers({
      breachId,
      subjects: [...people.subjects, { type: "user", id: late.id }],
    });
    await h.drain();

    expect(more).toMatchObject({ ok: true, noticesQueued: 1 });
    expect(notices(h).map((m) => m.to)).toHaveLength(4);
    expect(notices(h).at(-1)?.to).toBe("sana@example.test");
  });

  it("reports a child with no active guardian, and tells no one about them", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    const parent = await h.seed.guardian({
      children: [{ fullName: "Isha Desai", age: 8 }],
    });
    const childId = parent.childIds[0]!;
    await h.db
      .update(guardianLink)
      .set({ revokedAt: h.clock.now() })
      .where(eq(guardianLink.participantProfileId, childId));

    const staff = h.as(admin);
    const request = {
      breachId,
      subjects: [{ type: "participant_profile", id: childId }],
    };
    const result = await staff.notifyAffectedUsers(request);
    await h.drain();

    expect(result).toEqual({
      ok: true,
      noticesQueued: 0,
      unreachable: [
        {
          ref: { type: "participant_profile", id: childId },
          reason: "no_guardian",
        },
      ],
      unmatchedEmails: [],
      fanOut: false,
    });
    expect(notices(h)).toEqual([]);
    expect((await storedBreach(h, breachId)).status).toBe("open");
    const view = await h.as(admin).getBreach({ breachId });
    expect(view).toMatchObject({
      ok: true,
      breach: { unreachable: { total: 1, noGuardian: 1, noAccount: 0 } },
    });
    const audit = await breachAudit(h, breachId);
    expect.soft(audit.at(-1)).toMatchObject({
      action: "breach.principal_notice_reach_updated",
      after: { reachGapsAdded: { no_guardian: 1, no_account: 0 } },
    });
    expect(JSON.stringify(audit)).not.toContain(childId);
    h.clock.advance({ minutes: 1 });
    await expect(staff.notifyAffectedUsers(request)).resolves.toEqual(result);
    expect(await breachAudit(h, breachId)).toEqual(audit);
  });

  it.each([false, true])(
    "resumes suppressed channels after guardian verification (inbox already delivered: %s)",
    async (inboxDelivered) => {
      const h = await noticeHarness(PRINCIPAL_NOTICE);
      const admin = await staffActor(h, "staff_admin");
      const staff = h.as(admin);
      const breachId = await recordedBreach(h, admin);
      const parent = await h.seed.guardian({
        children: [{ fullName: "Isha Desai", age: 8 }],
      });
      const childId = parent.childIds[0]!;
      const request = {
        breachId,
        subjects: [{ type: "participant_profile", id: childId }],
      };
      await expect(staff.notifyAffectedUsers(request)).resolves.toMatchObject({
        ok: true,
        noticesQueued: 1,
      });
      if (inboxDelivered) {
        h.email.failNext(1);
        await h.drain();
      }
      await h.db
        .update(guardian)
        .set({ verifiedAt: null, verificationMethod: null })
        .where(eq(guardian.userId, parent.account.id));
      h.clock.advance({ seconds: 30 });
      await h.drain();
      expect(notices(h)).toEqual([]);
      expect(await inboxTitles(h, parent.account.id)).toHaveLength(
        inboxDelivered ? 1 : 0
      );
      expect(await staff.getBreach({ breachId })).toMatchObject({
        ok: true,
        breach: { unreachable: { total: 1, noGuardian: 1 } },
      });
      const [original] = await breachEvents(h, breachId, PRINCIPAL_NOTICE);

      const guardianActor = await h.signIn(parent.account);
      await h.as(guardianActor).startGuardianVerification();
      await expect(
        h.as(guardianActor).confirmGuardianVerification({
          code: h.email.codeFor(parent.account.email)!,
        })
      ).resolves.toEqual({ ok: true });
      await expect(staff.notifyAffectedUsers(request)).resolves.toMatchObject({
        ok: true,
        unreachable: [],
      });
      const audit = await breachAudit(h, breachId);
      expect.soft(audit.at(-1)?.after).toMatchObject({
        reachGapsCleared: { no_guardian: 1, no_account: 0 },
      });
      expect(JSON.stringify(audit)).not.toContain(childId);
      await expect(staff.notifyAffectedUsers(request)).resolves.toMatchObject({
        ok: true,
        noticesQueued: 0,
      });
      expect(await breachAudit(h, breachId)).toEqual(audit);

      // The earlier worker may have saved suppression before losing its claim.
      await h.db
        .update(outbox)
        .set({
          status: "pending",
          dispatchedAt: null,
          availableAt: new Date(h.clock.now().getTime() - 1),
        })
        .where(eq(outbox.id, original!.id));
      await h.drain();
      await h.drain();
      expect(notices(h).map(({ to }) => to)).toEqual([parent.account.email]);
      expect(await inboxTitles(h, parent.account.id)).toHaveLength(1);
      expect(await staff.getBreach({ breachId })).toMatchObject({
        ok: true,
        breach: {
          status: "notified",
          notices: { recipients: 1, pending: 0 },
          unreachable: { total: 0 },
        },
      });
    }
  );

  it("keeps a suppressed email quiet when the account still has no email address", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "staff_admin");
    const staff = h.as(admin);
    const breachId = await recordedBreach(h, admin);
    const member = await h.seed.member({ phone: "+919876543210" });
    await h.db
      .update(user)
      .set({ email: null, emailVerified: false })
      .where(eq(user.id, member.id));
    const request = { breachId, subjects: [{ type: "user", id: member.id }] };
    await expect(staff.notifyAffectedUsers(request)).resolves.toMatchObject({
      ok: true,
      noticesQueued: 1,
    });
    await h.drain();
    expect(notices(h)).toEqual([]);
    expect(await inboxTitles(h, member.id)).toHaveLength(1);

    const audit = await breachAudit(h, breachId);
    await expect(staff.notifyAffectedUsers(request)).resolves.toMatchObject({
      ok: true,
      noticesQueued: 0,
    });
    expect(await breachAudit(h, breachId)).toEqual(audit);
    expect(await breachEvents(h, breachId, PRINCIPAL_NOTICE)).toHaveLength(1);
  });

  it("finds people by their account's email address, and lists addresses with no account", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "staff_admin");
    const breachId = await recordedBreach(h, admin);
    await h.seed.member({ name: "Meera Iyer", email: "meera@example.test" });

    const result = await h.as(admin).notifyAffectedUsers({
      breachId,
      subjects: [
        { type: "email", address: " Meera@Example.test " },
        { type: "email", address: "nobody@example.test" },
      ],
    });
    await h.drain();

    expect(result).toMatchObject({
      ok: true,
      noticesQueued: 1,
      unmatchedEmails: ["nobody@example.test"],
    });
    expect(notices(h).map((m) => m.to)).toEqual(["meera@example.test"]);
  });

  it("tells no one about a closed breach", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    await h.as(admin).containBreach({ breachId });
    await h.as(admin).closeBreach({ breachId, reason: "Nothing left FOA." });
    const member = await h.seed.member();

    const result = await h.as(admin).notifyAffectedUsers({
      breachId,
      subjects: [{ type: "user", id: member.id }],
    });

    expect(result).toEqual({ ok: false, error: "breach_closed" });
    expect(await noticeRows(h, breachId)).toEqual([]);
  });

  it("tells every account through the outbox, not in the request, routing a teen to their guardian", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    const people = await family(h);

    const result = await h
      .as(admin)
      .notifyAffectedUsers({ breachId, subjects: "all_users" });

    expect(result).toEqual({
      ok: true,
      noticesQueued: 0,
      unreachable: [],
      unmatchedEmails: [],
      fanOut: true,
    });
    expect(await noticeRows(h, breachId)).toEqual([]);
    expect(await storedBreach(h, breachId)).toMatchObject({
      status: "open",
      principalsNotifiedAt: null,
    });

    h.clock.advance({ minutes: 1 });
    await h.drain();

    expect(await storedBreach(h, breachId)).toMatchObject({
      status: "notified",
      principalsNotifiedAt: h.clock.now(),
    });
    const accounts = await h.db.select({ id: user.id }).from(user);
    const told = new Set(
      (await noticeRows(h, breachId)).map((row) => row.recipientUserId)
    );
    expect(told).toEqual(
      new Set(
        accounts
          .map((account) => account.id)
          .filter((id) => id !== people.teen.id)
      )
    );
    expect(
      notices(h).some((message) => message.to === "rohan@example.test")
    ).toBe(false);
  });
});

describe("the breach.fanOut job", () => {
  it("audits a request before any notice exists and keeps the breach available for retry", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const staff = h.as(admin);
    const breachId = await recordedBreach(h, admin);
    const input = { breachId, subjects: "all_users" };
    await staff.containBreach({ breachId });
    await expect(staff.notifyAffectedUsers(input)).resolves.toMatchObject({
      ok: true,
      noticesQueued: 0,
      fanOut: true,
    });

    const [job] = await breachEvents(h, breachId, "breach.fan_out_requested");
    const beforeWorker = await staff.getBreach({ breachId });
    const close = await staff.closeBreach({ breachId });
    expect.soft(beforeWorker).toMatchObject({
      ok: true,
      breach: {
        status: "contained",
        principalsNotifiedAt: null,
        notices: { recipients: 0 },
      },
    });
    expect.soft(close).toEqual({ ok: false, error: "reason_required" });
    expect(beforeWorker.ok && beforeWorker.breach.allowedEvents).not.toContain(
      "close"
    );
    await expect(
      staff.closeBreach({ breachId, reason: "No notice needed." })
    ).resolves.toEqual({
      ok: false,
      error: "fan_out_pending",
    });
    expect(await timelineKinds(h, breachId)).toEqual(["recorded", "contained"]);
    const audit = await breachAudit(h, breachId);
    expect(audit.map(({ action }) => action)).toEqual([
      "breach.recorded",
      "breach.contained",
      "breach.fan_out_requested",
    ]);
    expect(audit.at(-1)).toMatchObject({
      before: { status: "contained", principalsNotifiedAt: null },
      after: { status: "contained", principalsNotifiedAt: null },
    });

    // The relay sees an exhausted claim whose worker never saved a page.
    await h.db
      .update(outbox)
      .set({ attempts: 5, lockedUntil: new Date(h.clock.now().getTime() - 1) })
      .where(eq(outbox.id, job!.id));
    await h.drain();
    expect(
      await breachEvents(h, breachId, "breach.fan_out_requested")
    ).toMatchObject([{ id: job!.id, status: "failed" }]);
    expect(await staff.getBreach({ breachId })).toEqual({
      ...beforeWorker,
      breach: {
        ...(beforeWorker.ok && beforeWorker.breach),
        canRetryPrincipalNotices: true,
      },
    });
    expect(await staff.closeBreach({ breachId })).toEqual({
      ok: false,
      error: "reason_required",
    });

    h.clock.advance({ minutes: 1 });
    await expect(staff.notifyAffectedUsers(input)).resolves.toMatchObject({
      ok: true,
      fanOut: true,
    });
    const afterRetry = await breachAudit(h, breachId);
    expect.soft(afterRetry.slice(audit.length)).toMatchObject([
      {
        action: "breach.principal_notices_requeued",
        after: { eventsRequeued: 1 },
      },
    ]);
    await expect(staff.notifyAffectedUsers(input)).resolves.toMatchObject({
      ok: true,
      fanOut: true,
    });
    expect(await breachAudit(h, breachId)).toEqual(afterRetry);
    await h.drain();
    expect(
      await breachEvents(h, breachId, "breach.fan_out_requested")
    ).toMatchObject([{ id: job!.id, status: "dispatched", attempts: 1 }]);
    expect(await timelineKinds(h, breachId)).toEqual([
      "recorded",
      "contained",
      "principals_notified",
    ]);
    expect(
      (await breachAudit(h, breachId)).slice(afterRetry.length)
    ).toMatchObject([
      { action: "breach.fan_out_completed" },
      {
        action: "breach.principals_notified",
        before: { status: "contained", principalsNotifiedAt: null },
        after: {
          status: "notified",
          principalsNotifiedAt: h.clock.now().toISOString(),
          noticesSent: 1,
        },
      },
    ]);
    await expect(staff.closeBreach({ breachId })).resolves.toEqual({
      ok: true,
      status: "closed",
    });
  });

  it("records one request and one audited completion across repeated all-account submissions", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    const member = await h.seed.member();
    const staff = h.as(admin);
    const input = { breachId, subjects: "all_users" };

    await expect(staff.notifyAffectedUsers(input)).resolves.toMatchObject({
      ok: true,
      fanOut: true,
    });
    await expect(staff.notifyAffectedUsers(input)).resolves.toMatchObject({
      ok: true,
      fanOut: true,
    });
    await h.drain();
    await expect(staff.notifyAffectedUsers(input)).resolves.toMatchObject({
      ok: true,
      fanOut: true,
    });
    await h.drain();

    expect(
      await breachEvents(h, breachId, "breach.fan_out_requested")
    ).toMatchObject([{ status: "dispatched" }]);
    expect(await timelineKinds(h, breachId)).toEqual([
      "recorded",
      "principals_notified",
    ]);
    expect(
      (await breachAudit(h, breachId)).map(({ action }) => action)
    ).toEqual([
      "breach.recorded",
      "breach.fan_out_requested",
      "breach.fan_out_completed",
      "breach.principals_notified",
      "breach.principal_notice_delivered",
    ]);
    expect(notices(h).filter(({ to }) => to === member.email)).toHaveLength(1);
  });

  it("finishes notices already queued when staff close the breach", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const actor = await staffActor(h, "staff_admin");
    const staff = h.as(actor);
    const member = await h.seed.member();
    const breachId = await recordedBreach(h, actor);

    await startPagedFanOut(h, actor, breachId, 1);
    await expect(staff.containBreach({ breachId })).resolves.toMatchObject({
      ok: true,
    });
    await drainOutbox(h.deps, { limit: 1 });
    expect(await noticeRows(h, breachId)).toHaveLength(2);
    expect(notices(h)).toEqual([]);
    await expect(staff.closeBreach({ breachId })).resolves.toEqual({
      ok: false,
      error: "reason_required",
    });
    await expect(
      staff.notifyAuthority({ breachId, manualReference: "Example filing" })
    ).resolves.toEqual({ ok: true, channel: "manual" });
    await expect(staff.closeBreach({ breachId })).resolves.toMatchObject({
      ok: true,
    });
    await h.drain();

    expect(
      notices(h).filter((message) => message.to === member.email)
    ).toHaveLength(1);
    expect(await storedBreach(h, breachId)).toMatchObject({ status: "closed" });
  });

  it("pages through accounts from the cursor on its payload, telling each once", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    for (const name of ["Asha", "Bina", "Chandra", "Divya"]) {
      await h.seed.member({
        name,
        email: `${name.toLowerCase()}@example.test`,
      });
    }
    const accounts = await h.db.select({ id: user.id }).from(user);

    await startPagedFanOut(h, admin, breachId, 2);
    await h.drain();

    const pages = await h.db
      .select({ id: outbox.id })
      .from(outbox)
      .where(
        and(
          eq(outbox.eventType, "breach.fan_out_requested"),
          eq(outbox.aggregateId, breachId)
        )
      );
    expect(pages).toHaveLength(Math.floor(accounts.length / 2) + 1);
    const recipients = (await noticeRows(h, breachId)).map(
      (row) => row.recipientUserId
    );
    expect(new Set(recipients).size).toBe(accounts.length);
    expect(recipients).toHaveLength(accounts.length * 2);
  });

  it("ignores a repeated full page and resumes the original failed continuation", async () => {
    const h = await noticeHarness(PRINCIPAL_NOTICE);
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    await h.seed.member();
    await h.seed.member();
    const firstId = await startPagedFanOut(h, admin, breachId, 2);
    await drainOutbox(h.deps, { limit: 1 });
    const pages = await breachEvents(h, breachId, "breach.fan_out_requested");
    expect(pages).toHaveLength(2);
    const continuation = pages.find(({ id }) => id !== firstId)!;
    expect(continuation.status).toBe("pending");
    const audit = await breachAudit(h, breachId);
    const justBeforeNow = new Date(h.clock.now().getTime() - 1);

    await h.db
      .update(outbox)
      .set({
        status: "pending",
        dispatchedAt: null,
        availableAt: justBeforeNow,
      })
      .where(eq(outbox.id, firstId));
    await drainOutbox(h.deps, { limit: 1 });

    expect(
      await breachEvents(h, breachId, "breach.fan_out_requested")
    ).toHaveLength(pages.length);
    expect(await breachAudit(h, breachId)).toEqual(audit);

    // Model a worker whose final claim expired before it could save a result.
    await h.db
      .update(outbox)
      .set({ attempts: 5, lockedUntil: justBeforeNow })
      .where(eq(outbox.id, continuation.id));
    await h.drain();
    expect(await breachEvents(h, breachId, "breach.fan_out_requested")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: continuation.id, status: "failed" }),
      ])
    );
    const partialAudit = await breachAudit(h, breachId);
    expect(partialAudit.slice(0, audit.length)).toEqual(audit);
    expect(
      partialAudit.slice(audit.length).map(({ action }) => action)
    ).toEqual([
      "breach.principals_notified",
      "breach.principal_notice_delivered",
    ]);

    await expect(
      h.as(admin).notifyAffectedUsers({ breachId, subjects: "all_users" })
    ).resolves.toMatchObject({ ok: true, fanOut: true });
    await h.drain();
    expect(await breachEvents(h, breachId, "breach.fan_out_requested")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: continuation.id,
          status: "dispatched",
          attempts: 1,
        }),
      ])
    );
    expect(
      (await breachAudit(h, breachId)).map(({ action }) => action)
    ).toEqual([
      "breach.recorded",
      "breach.fan_out_requested",
      "breach.principals_notified",
      "breach.principal_notice_delivered",
      "breach.principal_notices_requeued",
      "breach.fan_out_completed",
      "breach.principal_notice_delivered",
    ]);
    expect(notices(h)).toHaveLength(3);
  });

  it.each(["before", "after"] as const)(
    "combines a guardian's own and child's notices when their account is paged %s the child's",
    async (order) => {
      const h = await noticeHarness(PRINCIPAL_NOTICE);
      const admin = await staffActor(h, "super_admin");
      const breachId = await recordedBreach(h, admin);
      const guardianDetails = {
        name: "Kavita Desai",
        email: "kavita@example.test",
      };
      h.clock.advance({ seconds: 1 });
      if (order === "before") await h.seed.member(guardianDetails);
      h.clock.advance({ seconds: 1 });
      const child = await h.seed.member({
        name: "Rohan Desai",
        email: "rohan@example.test",
      });
      h.clock.advance({ seconds: 1 });
      const parent = await h.seed.guardian({
        ...guardianDetails,
        children: [
          { fullName: "Rohan Desai", age: 15, loginUserId: child.id },
          { fullName: "Isha Desai", age: 9 },
        ],
      });
      expect(parent.account.id < child.id).toBe(order === "before");

      await startPagedFanOut(h, admin, breachId, 2);
      await h.drain();

      const about = "your personal data and that of a child you look after";
      expect(
        notices(h).filter((message) => message.to === parent.account.email)
      ).toEqual([
        expect.objectContaining({ text: expect.stringContaining(about) }),
      ]);
      expect(await inboxTitles(h, parent.account.id)).toEqual([
        expect.objectContaining({ body: expect.stringContaining(about) }),
      ]);
      expect(notices(h).some((message) => message.to === child.email)).toBe(
        false
      );
      expect(await inboxTitles(h, child.id)).toEqual([]);
      expect(
        (await noticeRows(h, breachId)).filter(
          (row) => row.recipientUserId === parent.account.id
        )
      ).toEqual(
        ["email", "in_app"].map((channel) => ({
          recipientUserId: parent.account.id,
          channel,
          recipientRole: "principal_and_guardian",
          aboutCount: 2,
        }))
      );
    }
  );

  it("refuses a page larger than 500 accounts", async () => {
    const h = await createHarness();
    const breachId = uuidv7(h.clock.now());

    await expect(
      h.db.transaction((tx) =>
        emit(tx, h.clock, {
          type: "breach.fan_out_requested",
          aggregate: { type: "breach", id: breachId },
          payload: { breachId, afterUserId: null, pageSize: 501 },
        })
      )
    ).rejects.toThrow();
    expect(
      await h.db.execute(sql`SELECT count(*)::int AS n FROM outbox`)
    ).toMatchObject({ rows: [{ n: 0 }] });
  });
});
