import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  guardianLink,
  inboxItem,
  notificationPreference,
  outbox,
  user,
} from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { emit } from "@/server/outbox";
import { createHarness, type Harness } from "@/test/harness";

import {
  breachAudit,
  recordedBreach,
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
  it("tells the adult and both children's guardians, never the teen, even with optional email off", async () => {
    const h = await createHarness();
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
    expect((await breachAudit(h, breachId)).at(-1)).toMatchObject({
      action: "breach.principals_notified",
      before: { status: "open" },
      after: {
        status: "notified",
        principalsNotifiedAt: h.clock.now().toISOString(),
        noticesSent: 3,
      },
    });
  });

  it("carries nothing of the breach's title or impact to anyone", async () => {
    const h = await createHarness();
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
    const h = await createHarness();
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

  it("sends nothing new on a replay or a second drain, and one notice for one new person", async () => {
    const h = await createHarness();
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
    const h = await createHarness();
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

    const result = await h.as(admin).notifyAffectedUsers({
      breachId,
      subjects: [{ type: "participant_profile", id: childId }],
    });
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
  });

  it("finds people by their account's email address, and lists addresses with no account", async () => {
    const h = await createHarness();
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
    const h = await createHarness();
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
    const h = await createHarness();
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
      status: "notified",
      principalsNotifiedAt: h.clock.now(),
    });

    await h.drain();

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
  it("finishes notices already queued when staff close the breach", async () => {
    const h = await createHarness();
    const actor = await staffActor(h, "staff_admin");
    const staff = h.as(actor);
    const member = await h.seed.member();
    const breachId = await recordedBreach(h, actor);

    await expect(
      staff.notifyAffectedUsers({ breachId, subjects: "all_users" })
    ).resolves.toMatchObject({ ok: true, fanOut: true });
    await expect(staff.containBreach({ breachId })).resolves.toMatchObject({
      ok: true,
    });
    await expect(staff.closeBreach({ breachId })).resolves.toMatchObject({
      ok: true,
    });
    await h.drain();

    expect(
      notices(h).filter((message) => message.to === member.email)
    ).toHaveLength(1);
  });

  it("pages through accounts from the cursor on its payload, telling each once", async () => {
    const h = await createHarness();
    const admin = await staffActor(h, "super_admin");
    const breachId = await recordedBreach(h, admin);
    for (const name of ["Asha", "Bina", "Chandra", "Divya"]) {
      await h.seed.member({
        name,
        email: `${name.toLowerCase()}@example.test`,
      });
    }
    const accounts = await h.db.select({ id: user.id }).from(user);

    await h.db.transaction((tx) =>
      emit(tx, h.clock, {
        type: "breach.fan_out_requested",
        aggregate: { type: "breach", id: breachId },
        payload: { breachId, afterUserId: null, pageSize: 2 },
      })
    );
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

  it.each(["before", "after"] as const)(
    "combines a guardian's own and child's notices when their account is paged %s the child's",
    async (order) => {
      const h = await createHarness();
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

      await h.db.transaction((tx) =>
        emit(tx, h.clock, {
          type: "breach.fan_out_requested",
          aggregate: { type: "breach", id: breachId },
          payload: { breachId, afterUserId: null, pageSize: 2 },
        })
      );
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
