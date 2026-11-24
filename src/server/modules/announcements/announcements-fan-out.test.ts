import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditLog,
  guardianLink,
  inboxItem,
  messageDelivery,
  messageTemplate,
  outbox,
  registration,
  user,
} from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { drainUntilIdle } from "@/server/outbox";
import { createHarness, type Harness } from "@/test/harness";

import {
  announcementWorld,
  bornYearsBefore2027,
  FULL_AUDIENCE_EMAILS,
  fullAudience,
  registerChild,
  registrants,
  sampleContent,
  SAMPLE_SUBJECT,
} from "./testing";

// #84 AC4, AC5, AC7 and AC8: once the event is drained, every planned
// recipient has one email; account holders also have one inbox item, and
// contact details with no account get email (and SMS) only. Messages about
// a minor go to the guardian, never the minor. Draining again, or a retry
// after a failed send, sends nobody a second copy. SMS follows the switch,
// the phone and each account's choice.

const DLT_ID = "1107170000000000084";

/** Who received the announcement by email, sorted. */
function announcementEmails(h: Harness): string[] {
  return h.email.sent
    .filter((message) => message.subject === SAMPLE_SUBJECT)
    .map((message) => message.to.toLowerCase())
    .sort();
}

/** The email address of each account with the announcement in its inbox. */
async function inboxHolders(h: Harness): Promise<string[]> {
  const rows = await h.db
    .select({ email: user.email })
    .from(inboxItem)
    .innerJoin(user, eq(user.id, inboxItem.userId))
    .where(eq(inboxItem.templateKey, "announcements.announcement"));
  return rows.map((row) => row.email ?? "").sort();
}

async function sendFullAudience(h: Harness) {
  const world = await announcementWorld(h);
  const people = await fullAudience(h, world);
  const manager = await world.manager();
  const id = await world.draft(manager);
  // The set-up's own messages (the school's verification) go first.
  await h.drain();
  const sent = await h.as(manager).sendAnnouncement({ id, revision: 1 });
  if (!sent.ok) throw new Error(`Not sent: ${sent.error}`);
  return { world, people, id };
}

/** Gives the announcement's SMS wording a DLT registration. */
async function registerAnnouncementSms(h: Harness) {
  await h.db
    .update(messageTemplate)
    .set({ dltTemplateId: DLT_ID })
    .where(
      and(
        eq(messageTemplate.key, "announcements.announcement"),
        eq(messageTemplate.channel, "sms")
      )
    );
}

function drainWithEmailOutage(h: Harness, address: string) {
  return drainUntilIdle({
    ...h.deps,
    email: {
      send(message) {
        if (message.to === address) h.email.failNext(1);
        return h.email.send(message);
      },
    },
  });
}

describe("the announcement fan-out", () => {
  it("routes a linked participant by their age at send time in India", async () => {
    const h = await createHarness();
    // Seed the linked profile while it is 17, with its birthday on 15 January.
    h.clock.set("2026-02-14T06:00:00Z");
    const child = await h.seed.member({ email: "child@example.test" });
    const family = await h.seed.guardian({
      name: "Kavita Desai",
      email: "kavita@example.test",
      children: [{ fullName: "Rohan Desai", age: 17, loginUserId: child.id }],
    });
    h.clock.set("2027-01-14T18:20:00Z");
    const world = await announcementWorld(h);
    await registerChild(h, world.competition, family);
    const manager = h.as(await world.manager());
    const before = await manager.createAnnouncement({
      competitionId: world.competitionId,
      content: sampleContent({ subject: "Before midnight" }),
    });
    if (!before.ok) throw new Error("Could not create the first draft");
    const after = await manager.createAnnouncement({
      competitionId: world.competitionId,
      content: sampleContent(),
    });
    if (!after.ok) throw new Error("Could not create the second draft");
    await expect(
      manager.sendAnnouncement({ id: before.announcement.id, revision: 1 })
    ).resolves.toMatchObject({
      ok: true,
      counts: { participants: 0, guardians: 1 },
    });

    h.clock.advance({ minutes: 10 });
    const id = after.announcement.id;
    const preview = await manager.previewAnnouncement({ id });
    const sent = await manager.sendAnnouncement({ id, revision: 1 });
    await h.drain();

    expect(
      h.email.sent
        .filter((mail) => mail.subject === "Paws for Thought: Before midnight")
        .map((mail) => mail.to)
    ).toEqual(["kavita@example.test"]);
    expect(announcementEmails(h)).toEqual(["child@example.test"]);
    expect(preview).toMatchObject({
      ok: true,
      preview: { counts: { participants: 1, guardians: 0 } },
    });
    expect(sent).toMatchObject({
      ok: true,
      counts: { participants: 1, guardians: 0 },
    });
  });

  it("counts a school student without a reachable channel as unreachable from their 18th birthday", async () => {
    const h = await createHarness();
    h.clock.set("2027-01-14T18:20:00Z");
    const world = await announcementWorld(h);
    await registrants(h, world.competition).school({
      name: "Hill School",
      coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
      students: [
        {
          fullName: "Aanya Rao",
          dateOfBirth: "2009-01-15",
          status: "confirmed",
          guardian: {
            name: "Kiran Rao",
            email: "kiran@example.test",
            phone: "+919000000303",
          },
        },
      ],
    });
    const manager = await world.manager();
    const asManager = h.as(manager);
    const before = await world.draft(manager, { subject: "Before midnight" });
    const after = await world.draft(manager);
    const minorCounts = {
      recipients: 2,
      participants: 0,
      guardians: 1,
      coordinators: 1,
      unreachable: 0,
    };
    await expect(
      asManager.previewAnnouncement({ id: before })
    ).resolves.toMatchObject({ ok: true, preview: { counts: minorCounts } });
    await expect(
      asManager.sendAnnouncement({ id: before, revision: 1 })
    ).resolves.toMatchObject({ ok: true, counts: minorCounts });

    // Both events drain after midnight in India. The first still uses its own send date.
    h.clock.set("2027-01-14T18:30:00Z");
    const preview = await asManager.previewAnnouncement({ id: after });
    const sent = await asManager.sendAnnouncement({ id: after, revision: 1 });
    await h.drain();

    const adultCounts = {
      recipients: 1,
      participants: 0,
      guardians: 0,
      coordinators: 1,
      unreachable: 1,
    };
    expect({ preview, sent, emails: announcementEmails(h) }).toMatchObject({
      preview: { ok: true, preview: { counts: adultCounts } },
      sent: { ok: true, counts: adultCounts },
      emails: ["meera@example.test"],
    });
    expect(
      h.email.sent
        .filter((mail) => mail.subject === "Paws for Thought: Before midnight")
        .map((mail) => mail.to)
        .sort()
    ).toEqual(["kiran@example.test", "meera@example.test"]);
  });

  it("gives a verified school guardian an inbox copy and honors their SMS opt-out", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const guardian = await h.seed.member({
      name: "Kiran Rao",
      email: "kiran@example.test",
      phone: "90000 00303",
    });
    const asGuardian = h.as(await h.signIn(guardian));
    await expect(
      asGuardian.updateNotificationPreferences({ email: true, sms: false })
    ).resolves.toMatchObject({ ok: true });
    await registrants(h, world.competition).school({
      name: "Hill School",
      coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
      students: [
        {
          fullName: "Aanya Rao",
          dateOfBirth: bornYearsBefore2027(10),
          status: "confirmed",
          guardian: {
            name: "Kiran Rao",
            email: "KIRAN@example.test",
            phone: "+91 90000 00303",
          },
        },
      ],
    });
    await h.settings.set("sms.enabled", true);
    await registerAnnouncementSms(h);
    const manager = await world.manager();
    const id = await world.draft(manager);
    await expect(
      h.as(manager).sendAnnouncement({ id, revision: 1 })
    ).resolves.toMatchObject({ ok: true });

    await h.drain();

    expect(announcementEmails(h)).toEqual([
      "kiran@example.test",
      "meera@example.test",
    ]);
    expect({
      inbox: (await asGuardian.listInbox()).filter(
        (item) => item.title === SAMPLE_SUBJECT
      ).length,
      texts: h.sms.sent.filter((message) => message.dltTemplateId === DLT_ID)
        .length,
    }).toEqual({ inbox: 1, texts: 0 });
  });

  it.each(["adult students", "guardians"] as const)(
    "emails separate accounts for school %s who share an unverified roster phone",
    async (role) => {
      const h = await createHarness();
      const world = await announcementWorld(h);
      const contacts = [
        { name: "Kiran Rao", email: "kiran@example.test" },
        { name: "Sana Khan", email: "sana@example.test" },
      ];
      for (const contact of contacts) await h.seed.member(contact);
      const phone = "+919000000303";
      await registrants(h, world.competition).school({
        name: "Hill School",
        coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
        students: contacts.map(({ name, email }) =>
          role === "adult students"
            ? {
                fullName: name,
                dateOfBirth: bornYearsBefore2027(19),
                email,
                phone,
                status: "confirmed",
              }
            : {
                fullName: `Child of ${name}`,
                dateOfBirth: bornYearsBefore2027(10),
                guardian: { name, email, phone },
                status: "confirmed",
              }
        ),
      });
      const manager = await world.manager();
      const id = await world.draft(manager);
      const asManager = h.as(manager);
      const counts = { recipients: 3 };
      await expect(
        asManager.previewAnnouncement({ id })
      ).resolves.toMatchObject({ ok: true, preview: { counts } });
      await expect(
        asManager.sendAnnouncement({ id, revision: 1 })
      ).resolves.toMatchObject({
        ok: true,
        counts,
      });

      await h.drain();

      const expected = [
        "kiran@example.test",
        "meera@example.test",
        "sana@example.test",
      ];
      expect(await inboxHolders(h)).toEqual(expected);
      expect(announcementEmails(h)).toEqual(expected);
    }
  );

  it("uses an independent roster guardian address when the shared phone belongs to a minor's login", async () => {
    const h = await createHarness();
    const teen = await h.seed.member({
      email: "teen@example.test",
      phone: "90000 00303",
    });
    await h.seed.guardian({
      children: [{ fullName: "Aanya Rao", age: 15, loginUserId: teen.id }],
    });
    const world = await announcementWorld(h);
    await registrants(h, world.competition).school({
      name: "Hill School",
      coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
      students: [
        {
          fullName: "Aanya Rao",
          dateOfBirth: bornYearsBefore2027(15),
          status: "confirmed",
          guardian: {
            name: "Kiran Rao",
            email: "kiran@example.test",
            phone: "+919000000303",
          },
        },
      ],
    });
    await h.settings.set("sms.enabled", true);
    await registerAnnouncementSms(h);
    const manager = await world.manager();
    const id = await world.draft(manager);
    await expect(
      h.as(manager).sendAnnouncement({ id, revision: 1 })
    ).resolves.toMatchObject({
      ok: true,
      counts: {
        recipients: 2,
        guardians: 1,
        coordinators: 1,
        unreachable: 0,
      },
    });

    await h.drain();

    expect({
      emails: announcementEmails(h),
      inbox: await inboxHolders(h),
      texts: h.sms.sent.filter((sms) => sms.dltTemplateId === DLT_ID),
    }).toEqual({
      emails: ["kiran@example.test", "meera@example.test"],
      inbox: ["meera@example.test"],
      texts: [],
    });
  });

  it.each([false, true])(
    "keeps both guardian emails when a shared roster phone is verified by one account (both have accounts: %s)",
    async (bothHaveAccounts) => {
      const h = await createHarness();
      const world = await announcementWorld(h);
      const kiran = { name: "Kiran Rao", email: "kiran@example.test" };
      const sana = { name: "Sana Khan", email: "sana@example.test" };
      const phone = "+919000000303";
      await h.seed.member({ ...kiran, phone });
      if (bothHaveAccounts) await h.seed.member(sana);
      await registrants(h, world.competition).school({
        name: "Hill School",
        coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
        students: [kiran, sana].map(({ name, email }) => ({
          fullName: `Child of ${name}`,
          dateOfBirth: bornYearsBefore2027(10),
          status: "confirmed",
          guardian: { name, email, phone },
        })),
      });
      const manager = await world.manager();
      const id = await world.draft(manager);
      const preview = await h.as(manager).previewAnnouncement({ id });
      const sent = await h.as(manager).sendAnnouncement({ id, revision: 1 });
      await h.drain();

      const counts = { recipients: 3, guardians: 2, unreachable: 0 };
      expect({
        preview,
        sent,
        emails: announcementEmails(h),
        inboxes: await inboxHolders(h),
      }).toMatchObject({
        preview: { ok: true, preview: { counts } },
        sent: { ok: true, announcement: { recipientCount: 3 }, counts },
        emails: [kiran.email, "meera@example.test", sana.email],
        inboxes: bothHaveAccounts
          ? [kiran.email, "meera@example.test", sana.email]
          : [kiran.email, "meera@example.test"],
      });
    }
  );

  it.each([false, true])(
    "emails separate roster guardians who share a phone, including on retry (SMS enabled: %s)",
    async (smsEnabled) => {
      const h = await createHarness();
      const world = await announcementWorld(h);
      const kiran = { name: "Kiran Rao", email: "kiran@example.test" };
      const sana = { name: "Sana Khan", email: "sana@example.test" };
      const phone = "+919000000303";
      await registrants(h, world.competition).school({
        name: "Hill School",
        coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
        students: [
          ...[kiran, sana].map(({ name, email }) => ({
            fullName: `Child of ${name}`,
            dateOfBirth: bornYearsBefore2027(10),
            status: "confirmed" as const,
            guardian: { name, email, phone },
          })),
          {
            fullName: "Sibling in the Rao family",
            dateOfBirth: bornYearsBefore2027(8),
            status: "confirmed",
            guardian: { name: kiran.name, email: null, phone },
          },
        ],
      });
      await h.settings.set("sms.enabled", smsEnabled);
      await registerAnnouncementSms(h);
      const manager = await world.manager();
      const id = await world.draft(manager);
      const preview = await h.as(manager).previewAnnouncement({ id });
      const sent = await h.as(manager).sendAnnouncement({ id, revision: 1 });
      await drainWithEmailOutage(h, sana.email);
      const firstEmails = announcementEmails(h);
      h.clock.advance({ minutes: 5 });
      await h.drain();

      const counts = { recipients: 3, guardians: 2, unreachable: 0 };
      expect({
        preview,
        sent,
        firstEmails,
        emails: announcementEmails(h),
        inboxes: await inboxHolders(h),
        texts: h.sms.sent
          .filter((sms) => sms.dltTemplateId === DLT_ID)
          .map((sms) => sms.to),
      }).toMatchObject({
        preview: { ok: true, preview: { counts } },
        sent: { ok: true, announcement: { recipientCount: 3 }, counts },
        firstEmails: [kiran.email, "meera@example.test"],
        emails: [kiran.email, "meera@example.test", sana.email],
        inboxes: ["meera@example.test"],
        texts: smsEnabled ? [phone] : [],
      });
    }
  );

  it("never reaches the minor who owns a listed family phone, and resolves the verified roster email to its account", async () => {
    const h = await createHarness();
    const teen = await h.seed.member({
      email: "teen@example.test",
      phone: "90000 00303",
    });
    await h.seed.guardian({
      children: [{ fullName: "Aanya Rao", age: 15, loginUserId: teen.id }],
    });
    await h.seed.member({ email: "kiran@example.test" });
    const world = await announcementWorld(h);
    await registrants(h, world.competition).school({
      name: "Hill School",
      coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
      students: [
        {
          fullName: "Aanya Rao",
          dateOfBirth: bornYearsBefore2027(15),
          status: "confirmed",
          guardian: {
            name: "Kiran Rao",
            email: "kiran@example.test",
            phone: "+919000000303",
          },
        },
      ],
    });
    const manager = await world.manager();
    const id = await world.draft(manager);
    await expect(
      h.as(manager).sendAnnouncement({ id, revision: 1 })
    ).resolves.toMatchObject({ ok: true });

    await h.drain();

    expect(announcementEmails(h)).toEqual([
      "kiran@example.test",
      "meera@example.test",
    ]);
    // The phone match alone adds nothing for the teen; Kiran's verified
    // email is account evidence, so her account gets the inbox copy.
    expect(await inboxHolders(h)).toEqual([
      "kiran@example.test",
      "meera@example.test",
    ]);
  });

  it("agrees on unreachable guardians in preview, send, audit and delivery", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    await registerAnnouncementSms(h);
    await registrants(h, world.competition).school({
      name: "Hill School",
      coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
      students: [
        {
          fullName: "Aanya Rao",
          dateOfBirth: bornYearsBefore2027(10),
          status: "confirmed",
          guardian: { name: "Kiran Rao", email: null, phone: "+919000000303" },
        },
      ],
    });
    const manager = await world.manager();
    const id = await world.draft(manager);

    const preview = await h.as(manager).previewAnnouncement({ id });
    const sent = await h.as(manager).sendAnnouncement({ id, revision: 1 });
    await h.drain();

    expect(announcementEmails(h)).toEqual(["meera@example.test"]);
    expect(h.sms.sent.filter((sms) => sms.dltTemplateId === DLT_ID)).toEqual(
      []
    );
    const counts = {
      recipients: 1,
      participants: 0,
      guardians: 0,
      coordinators: 1,
      unreachable: 1,
    };
    const [audit] = await h.db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "announcement.sent"), eq(auditLog.entityId, id))
      );
    expect({ preview, sent, audit }).toMatchObject({
      preview: { ok: true, preview: { counts } },
      sent: { ok: true, announcement: { recipientCount: 1 }, counts },
      audit: { after: { status: "sent", counts } },
    });
  });

  it("counts both siblings as reachable via one guardian email when SMS is off", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    await registrants(h, world.competition).school({
      name: "Hill School",
      coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
      students: [
        {
          fullName: "Aanya Rao",
          dateOfBirth: bornYearsBefore2027(10),
          status: "confirmed",
          guardian: { name: "Kiran Rao", email: null, phone: "+919000000303" },
        },
        {
          fullName: "Ishan Rao",
          dateOfBirth: bornYearsBefore2027(8),
          status: "confirmed",
          guardian: {
            name: "Kiran Rao",
            email: "kiran@example.test",
            phone: "+91 90000 00303",
          },
        },
      ],
    });
    const manager = await world.manager();
    const id = await world.draft(manager);
    const preview = await h.as(manager).previewAnnouncement({ id });
    const sent = await h.as(manager).sendAnnouncement({ id, revision: 1 });
    await h.drain();
    const [audit] = await h.db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "announcement.sent"), eq(auditLog.entityId, id))
      );

    expect(announcementEmails(h)).toEqual([
      "kiran@example.test",
      "meera@example.test",
    ]);
    const counts = {
      recipients: 2,
      guardians: 1,
      coordinators: 1,
      unreachable: 0,
    };
    expect({ preview, sent, audit }).toMatchObject({
      preview: { ok: true, preview: { counts } },
      sent: { ok: true, counts },
      audit: { after: { status: "sent", counts } },
    });
  });

  it.each([
    { case: "the remaining guardian address is unchanged", firstEmail: null },
    {
      case: "the remaining guardian address is different",
      firstEmail: "kiran-first@example.test",
    },
  ])(
    "does not resend after a sibling withdraws during a retry when $case",
    async ({ firstEmail }) => {
      const h = await createHarness();
      const originalEmail = firstEmail ?? "kiran@example.test";
      const world = await announcementWorld(h);
      const school = await registrants(h, world.competition).school({
        name: "Hill School",
        coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
        students: [
          {
            fullName: "Sana Khan",
            dateOfBirth: bornYearsBefore2027(19),
            email: "sana@example.test",
            phone: "+919000000202",
            status: "confirmed",
          },
          {
            fullName: "Aanya Rao",
            dateOfBirth: bornYearsBefore2027(10),
            guardian: {
              name: "Kiran Rao",
              email: firstEmail,
              phone: "+919000000303",
            },
            status: "enrolled",
          },
          {
            fullName: "Ishan Rao",
            dateOfBirth: bornYearsBefore2027(8),
            guardian: {
              name: "Kiran Rao",
              email: "kiran@example.test",
              phone: "+91 90000 00303",
            },
            status: "enrolled",
          },
        ],
      });
      const coordinator = h.as(await h.signIn(school.coordinators[0]!));
      const manager = await world.manager();
      const id = await world.draft(manager);
      await h.settings.set("sms.enabled", true);
      await registerAnnouncementSms(h);
      await h.drain();
      await expect(
        h.as(manager).sendAnnouncement({ id, revision: 1 })
      ).resolves.toMatchObject({ ok: true });
      await drainWithEmailOutage(h, "sana@example.test");
      // Conflicting listed emails keep the alias's two addresses distinct.
      const guardianEmails = [
        ...new Set([originalEmail, "kiran@example.test"]),
      ].sort();
      expect(announcementEmails(h)).toEqual([
        ...guardianEmails,
        "meera@example.test",
      ]);

      await expect(
        coordinator.withdrawStudent({
          institutionId: school.institutionId,
          reference: school.reference,
          registrationId: school.students[1]!.registrationId,
        })
      ).resolves.toEqual({ ok: true });
      h.clock.advance({ minutes: 5 });
      await h.drain();

      expect(announcementEmails(h)).toEqual([
        ...guardianEmails,
        "meera@example.test",
        "sana@example.test",
      ]);
      expect(
        h.sms.sent
          .filter((sms) => sms.dltTemplateId === DLT_ID)
          .map((sms) => sms.to)
          .sort()
      ).toEqual(["+919000000202", "+919000000303"]);
    }
  );

  it.each([
    {
      verifiedBy: "email",
      email: "kiran@example.test",
      phone: undefined,
      link: false,
      inboxCount: 1,
    },
    {
      verifiedBy: "a phone and verified guardian links",
      email: "kiran-new@example.test",
      phone: "90000 00303",
      link: true,
      inboxCount: 1,
      // A verified link replaces the listed contact. Its email doesn't
      // corroborate the listed one, so it is no roster alias (#273) and
      // gets its own copy; the listed address is never sent twice.
      resent: ["kiran-new@example.test"],
    },
    {
      verifiedBy: "a phone only, with a separate roster email",
      email: "kiran-new@example.test",
      phone: "90000 00303",
      link: false,
      inboxCount: 0,
    },
  ])(
    "does not resend an external delivery when an account appears before retry with $verifiedBy",
    async ({ email, phone, link, inboxCount, resent = [] }) => {
      const h = await createHarness();
      const { people } = await sendFullAudience(h);
      await drainWithEmailOutage(h, people.asha.email);
      expect(announcementEmails(h)).toEqual(
        FULL_AUDIENCE_EMAILS.filter((email) => email !== people.asha.email)
      );

      const guardian = await h.seed.member({
        name: "Kiran Rao",
        email,
        ...(phone ? { phone } : {}),
      });
      if (link) {
        const { guardianId } = await h.seed.guardian({
          name: "Kiran Rao",
          email,
          children: [],
        });
        const siblings = await h.db
          .select({ participantProfileId: registration.participantProfileId })
          .from(registration)
          .where(
            inArray(
              registration.id,
              people.school.students
                .slice(1, 3)
                .map(({ registrationId }) => registrationId)
            )
          );
        const now = h.clock.now();
        await h.db.insert(guardianLink).values(
          siblings.map(({ participantProfileId }) => ({
            id: uuidv7(now),
            guardianId,
            participantProfileId,
            relationship: "parent" as const,
            createdAt: now,
          }))
        );
      }
      const asGuardian = h.as(await h.signIn(guardian));
      h.clock.advance({ minutes: 5 });
      await h.drain();

      expect(announcementEmails(h)).toEqual(
        [...FULL_AUDIENCE_EMAILS, ...resent].sort()
      );
      expect(
        (await asGuardian.listInbox()).filter(
          (item) => item.title === SAMPLE_SUBJECT
        )
      ).toHaveLength(inboxCount);
    }
  );

  it("keeps each previous contact delivery with its destination when adults sharing a roster phone get accounts", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const kiran = { name: "Kiran Rao", email: "kiran@example.test" };
    const sana = { name: "Sana Khan", email: "sana@example.test" };
    await registrants(h, world.competition).school({
      name: "Hill School",
      coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
      students: [kiran, sana].map(({ name, email }) => ({
        fullName: name,
        dateOfBirth: bornYearsBefore2027(19),
        email,
        phone: "+919000000303",
        status: "confirmed",
      })),
    });
    const manager = await world.manager();
    const id = await world.draft(manager);
    await expect(
      h.as(manager).sendAnnouncement({ id, revision: 1 })
    ).resolves.toMatchObject({ ok: true, counts: { recipients: 3 } });
    await drainWithEmailOutage(h, "meera@example.test");
    // Both adults keep their own email; the shared phone is one destination.
    expect(announcementEmails(h)).toEqual([kiran.email, sana.email]);

    // The new individual registration puts Sana's account ahead of Kiran's on retry.
    await registrants(h, world.competition).adult(sana);
    await h.seed.member(kiran);
    h.clock.advance({ minutes: 5 });
    await h.drain();

    expect(announcementEmails(h)).toEqual([
      kiran.email,
      "meera@example.test",
      sana.email,
    ]);
  });

  it("rechecks enrolment before retrying a failed delivery", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const school = await registrants(h, world.competition).school({
      name: "Hill School",
      coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
      students: [
        {
          fullName: "Sana Khan",
          dateOfBirth: bornYearsBefore2027(19),
          email: "sana@example.test",
          status: "confirmed",
        },
        {
          fullName: "Aanya Rao",
          dateOfBirth: bornYearsBefore2027(10),
          status: "enrolled",
          guardian: {
            name: "Kiran Rao",
            email: "kiran@example.test",
            phone: "+919000000303",
          },
        },
      ],
    });
    const coordinator = h.as(await h.signIn(school.coordinators[0]!));
    const manager = await world.manager();
    const id = await world.draft(manager);
    await h.drain();
    await expect(
      h.as(manager).sendAnnouncement({ id, revision: 1 })
    ).resolves.toMatchObject({ ok: true, counts: { recipients: 3 } });
    await drainWithEmailOutage(h, "kiran@example.test");
    expect(announcementEmails(h)).toEqual([
      "meera@example.test",
      "sana@example.test",
    ]);

    await expect(
      coordinator.withdrawStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        registrationId: school.students[1]!.registrationId,
      })
    ).resolves.toEqual({ ok: true });
    h.clock.advance({ minutes: 5 });
    await h.drain();

    expect(announcementEmails(h)).toEqual([
      "meera@example.test",
      "sana@example.test",
    ]);
    expect(await inboxHolders(h)).toEqual(["meera@example.test"]);
  });

  it("texts a school guardian who shares an account holder's phone once, without joining the account", async () => {
    const h = await createHarness();
    await h.settings.set("sms.enabled", true);
    await registerAnnouncementSms(h);
    const world = await announcementWorld(h);
    const add = registrants(h, world.competition);
    await add.adult({
      name: "Asha Rao",
      email: "asha@example.test",
      phone: "90000 00101",
    });
    await add.school({
      name: "Hill School",
      coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
      students: [
        {
          fullName: "Aanya Rao",
          dateOfBirth: bornYearsBefore2027(10),
          status: "confirmed",
          guardian: { name: "Asha Rao", email: null, phone: "+91 90000 00101" },
        },
      ],
    });
    const manager = await world.manager();
    const id = await world.draft(manager);
    expect(
      await h.as(manager).sendAnnouncement({ id, revision: 1 })
    ).toMatchObject({
      ok: true,
      // A phone match alone is no account evidence (#273): the listed
      // guardian is counted separately, and the shared number texted once.
      counts: { recipients: 3, participants: 1, guardians: 1, coordinators: 1 },
    });

    await h.drain();

    expect(announcementEmails(h)).toEqual([
      "asha@example.test",
      "meera@example.test",
    ]);
    expect(await inboxHolders(h)).toEqual([
      "asha@example.test",
      "meera@example.test",
    ]);
    expect(
      h.sms.sent.filter((sms) => sms.dltTemplateId === DLT_ID)
    ).toHaveLength(1);
  });

  it("routes every enrolled student at a confirmed school, scoped to the announcement's competition", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const add = registrants(h, world.competition);
    await add.school({
      name: "Hill School",
      coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
      students: [
        {
          fullName: "Sana Khan",
          dateOfBirth: bornYearsBefore2027(19),
          email: "sana@example.test",
          status: "confirmed",
        },
        {
          fullName: "Aanya Rao",
          dateOfBirth: bornYearsBefore2027(10),
          status: "enrolled",
          guardian: {
            name: "Kiran Rao",
            email: "kiran@example.test",
            phone: "+919000000303",
          },
        },
      ],
    });
    await add.school({
      name: "Valley School",
      coordinators: [{ name: "Arun Pillai", email: "arun@example.test" }],
      students: [
        {
          fullName: "Dev Patel",
          dateOfBirth: bornYearsBefore2027(19),
          email: "dev@example.test",
          status: "enrolled",
        },
      ],
    });
    await registrants(h, world.otherCompetition).adult({
      name: "Vikram Shah",
      email: "vikram@example.test",
    });
    const manager = await world.manager();
    const id = await world.draft(manager);
    expect(
      await h.as(manager).sendAnnouncement({ id, revision: 1 })
    ).toMatchObject({
      ok: true,
      counts: { recipients: 3 },
    });

    await h.drain();

    expect(announcementEmails(h)).toEqual([
      "kiran@example.test",
      "meera@example.test",
      "sana@example.test",
    ]);
  });

  it("delivers a service announcement even after a registrant withdraws consent to updates", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const account = await registrants(h, world.competition).adult({
      name: "Asha Rao",
      email: "asha@example.test",
    });
    const admin = await h.signIn(await h.seed.superAdmin());
    const document = await h.as(admin).publishConsentDocument({
      purpose: "messages",
      title: "News and updates",
      source:
        "## What you agree to {#what-you-agree-to}\n\nNews and updates by email.",
    });
    if (!document.ok) throw new Error("Could not publish messages consent.");
    const recipient = h.as(await h.signIn(account));
    await recipient.giveConsent({
      purpose: "messages",
      documentId: document.id,
    });
    expect(
      await recipient.withdrawConsent({ purpose: "messages" })
    ).toMatchObject({
      ok: true,
    });
    const manager = await world.manager();
    const id = await world.draft(manager);
    expect(
      await h.as(manager).sendAnnouncement({ id, revision: 1 })
    ).toMatchObject({
      ok: true,
    });

    await h.drain();

    expect(announcementEmails(h)).toEqual(["asha@example.test"]);
    expect(await inboxHolders(h)).toEqual(["asha@example.test"]);
  });

  it("emails every planned recipient once, and puts it in account holders' inboxes", async () => {
    const h = await createHarness();
    await sendFullAudience(h);

    await h.drain();

    expect(announcementEmails(h)).toEqual(FULL_AUDIENCE_EMAILS);
    // Kiran and Sana have no account: email only.
    expect(await inboxHolders(h)).toEqual([
      "arun@example.test",
      "asha@example.test",
      "kavita@example.test",
      "meera@example.test",
      "vikram@example.test",
    ]);
    const email = h.email.sent.find(
      (message) =>
        message.subject === SAMPLE_SUBJECT &&
        message.to === "kiran@example.test"
    );
    expect(email?.text).toContain("Hello Kiran Rao,");
    expect(email?.text).toContain("Street dogs of our city");
    expect(email?.text).toContain("Write to competitions@foa.example");
    expect(email?.html).toContain("<p>Hello Kiran Rao,</p>");
  });

  it("keeps help contacts encrypted in storage and shows them in the recipient's inbox", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    const adult = await registrants(h, world.competition).adult({
      name: "Asha Nair",
      email: "asha@example.test",
    });
    const manager = await world.manager();
    const helpEmail = "help@example.test";
    const helpPhone = "+919000000707";
    const helpContacts = `Reach Radha at ${helpEmail} or ${helpPhone}.`;
    const id = await world.draft(manager, { helpContacts });
    await expect(
      h.as(manager).sendAnnouncement({ id, revision: 1 })
    ).resolves.toMatchObject({ ok: true });
    await h.drain();

    const recipient = h.as(await h.signIn(adult));
    const item = (await recipient.listInbox()).find(
      (message) => message.title === SAMPLE_SUBJECT
    );
    expect(item?.body).toContain(helpContacts);
    expect(await h.as(manager).listInbox()).not.toContainEqual(
      expect.objectContaining({ title: SAMPLE_SUBJECT })
    );
    const rows = await h.db
      .select()
      .from(inboxItem)
      .where(eq(inboxItem.id, item!.id));
    expect(rows).toHaveLength(1);
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(helpEmail);
    expect(stored).not.toContain(helpPhone);
    expect(rows[0]).toMatchObject({
      title: "",
      body: "",
      titleCiphertext: expect.any(String),
      bodyCiphertext: expect.any(String),
    });
  });

  it("tells a teen's guardian and never the teen, and nobody for a child no one can reach", async () => {
    const h = await createHarness();
    const { people } = await sendFullAudience(h);

    await h.drain();

    expect(announcementEmails(h)).toContain("kavita@example.test");
    expect(announcementEmails(h)).not.toContain("rohan@example.test");
    const teenInbox = await h.db
      .select()
      .from(inboxItem)
      .where(
        and(
          eq(inboxItem.userId, people.teen.id),
          eq(inboxItem.templateKey, "announcements.announcement")
        )
      );
    expect(teenInbox).toEqual([]);
    // No unconfirmed or withdrawn registrant hears of it either.
    expect(announcementEmails(h)).not.toContain("pia@example.test");
    expect(announcementEmails(h)).not.toContain("nita@example.test");
    // No delivery row names the teen.
    expect(
      await h.db
        .select()
        .from(messageDelivery)
        .where(
          and(
            eq(messageDelivery.userId, people.teen.id),
            eq(messageDelivery.templateKey, "announcements.announcement")
          )
        )
    ).toEqual([]);
  });

  it("sends nobody a second copy when the event is drained again", async () => {
    const h = await createHarness();
    await sendFullAudience(h);
    await h.drain();

    await h.drain();

    expect(announcementEmails(h)).toEqual(FULL_AUDIENCE_EMAILS);
    expect(await inboxHolders(h)).toHaveLength(5);
  });

  it("sends nobody a second copy when a failed send is retried", async () => {
    const h = await createHarness();
    await sendFullAudience(h);
    // A mail outage persists through the first retry.
    h.email.failNext(1, new Error("SES is down"));
    await h.drain();
    expect(announcementEmails(h)).toHaveLength(FULL_AUDIENCE_EMAILS.length - 1);
    h.email.failNext(1, new Error("SES is down"));
    h.clock.advance({ minutes: 5 });
    await h.drain();
    h.clock.advance({ minutes: 30 });

    await h.drain();

    expect(announcementEmails(h)).toEqual(FULL_AUDIENCE_EMAILS);
    expect(await inboxHolders(h)).toHaveLength(5);
    // Contacts with no account are kept by a blind index, never the address.
    const contactRows = await h.db
      .select({ contactHash: messageDelivery.contactHash })
      .from(messageDelivery)
      .where(eq(messageDelivery.templateKey, "announcements.announcement"));
    for (const row of contactRows) {
      expect(row.contactHash ?? "").not.toContain("@");
    }
  });

  it("records an announcement failure code without persisting provider diagnostics", async () => {
    const h = await createHarness();
    const { id, people } = await sendFullAudience(h);
    h.email.failNext(
      1,
      new Error("Mailer refused Asha Rao's drawing day announcement")
    );
    await h.drain();

    const [event] = await h.db
      .select()
      .from(outbox)
      .where(eq(outbox.aggregateId, id));
    expect(event).toMatchObject({
      status: "pending",
      lastError: `announcement_delivery_failed: ${event?.eventId}`,
    });
    h.clock.advance({ minutes: 5 });
    await h.drain();
    expect(announcementEmails(h)).toEqual(FULL_AUDIENCE_EMAILS);
    expect(
      h.email
        .inbox(people.asha.email)
        .filter(({ subject }) => subject === SAMPLE_SUBJECT)
    ).toHaveLength(1);
  });

  it("sends no SMS while SMS is switched off", async () => {
    const h = await createHarness();
    await registerAnnouncementSms(h);
    await sendFullAudience(h);

    await h.drain();

    expect(h.sms.sent).toEqual([]);
    expect(announcementEmails(h)).toEqual(FULL_AUDIENCE_EMAILS);
  });

  it("sends an SMS to each recipient with a phone who hasn't turned SMS off, once SMS is on", async () => {
    const h = await createHarness();
    await h.settings.set("sms.enabled", true);
    await registerAnnouncementSms(h);
    await sendFullAudience(h);

    await h.drain();
    await h.drain();

    // Asha's account, Sana's own contact and the siblings' guardian, once;
    // not Vikram, who turned SMS off.
    expect(
      h.sms.sent
        .filter((sms) => sms.dltTemplateId === DLT_ID)
        .map((sms) => sms.to.replace(/\s+/g, ""))
        .sort()
    ).toEqual(["+919000000101", "+919000000202", "+919000000303"]);
    expect(h.sms.lastTo("+919000000303")?.text).toBe(
      'Friends of Animals: news about Paws for Thought, "Phase 3: the drawing day". For details, visit friendsofanimals.dev/contact.'
    );
    for (const sms of h.sms.sent.filter(
      ({ dltTemplateId }) => dltTemplateId === DLT_ID
    )) {
      expect(sms.vars).toEqual({
        "competition.name": "Paws for Thought",
        "announcement.subject": "Phase 3: the drawing day",
      });
    }
  });

  it("gives an SMS-only guardian a way to ask FOA for the announcement", async () => {
    const h = await createHarness();
    const world = await announcementWorld(h);
    await h.settings.set("sms.enabled", true);
    await registerAnnouncementSms(h);
    await registrants(h, world.competition).school({
      name: "Hill School",
      coordinators: [{ name: "Meera Iyer", email: "meera@example.test" }],
      students: [
        {
          fullName: "Aanya Rao",
          dateOfBirth: bornYearsBefore2027(10),
          status: "confirmed",
          guardian: { name: "Kiran Rao", email: null, phone: "+919000000303" },
        },
      ],
    });
    const manager = await world.manager();
    const id = await world.draft(manager);
    await expect(
      h.as(manager).sendAnnouncement({ id, revision: 1 })
    ).resolves.toMatchObject({
      ok: true,
      counts: { recipients: 2, guardians: 1, unreachable: 0 },
    });

    await h.drain();

    expect(announcementEmails(h)).toEqual(["meera@example.test"]);
    expect(await inboxHolders(h)).toEqual(["meera@example.test"]);
    expect(h.sms.lastTo("+919000000303")).toMatchObject({
      dltTemplateId: DLT_ID,
      text: 'Friends of Animals: news about Paws for Thought, "Phase 3: the drawing day". For details, visit friendsofanimals.dev/contact.',
    });
  });
});
