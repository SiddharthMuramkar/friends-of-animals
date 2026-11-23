import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { parsePhoneNumber } from "@/lib/phone";
import {
  guardianLink,
  notificationPreference,
  registration,
  user,
} from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { planDelivery } from "@/server/modules/notifications/domain/delivery-plan";
import {
  adultForm,
  openToIndividuals,
} from "@/server/modules/participants/testing";
import { setInstitutionFee } from "@/server/modules/payments/testing";
import type { StudentInput } from "@/server/modules/registration/domain/student-details";
import { registeredSchool } from "@/server/modules/registration/testing";
import { createHarness, type Harness } from "@/test/harness";

import {
  planAnnouncementAudience,
  rosterGuardianPhoneAlias,
  type AudiencePlan,
  type Candidate,
} from "./domain/audience";
import { loadAnnouncementAudience } from "./load-audience";

const SHARED_PHONE = "+919000000401";
const FAMILY_EMAIL = "family@example.test";
const SECOND_GUARDIAN_PHONE = "+919000000402";
const AGE_GROUPS = [{ label: "Everyone", minAge: 5, maxAge: 99 }];

function sibling(fullName: string, guardianEmail?: string): StudentInput {
  return {
    fullName,
    dateOfBirth: "2017-01-01",
    guardianName: "Listed Guardian",
    guardianRelationship: "parent",
    guardianPhone: SHARED_PHONE,
    guardianEmail,
  };
}

async function schoolRoster(h: Harness, name = "Audience School") {
  const school = await registeredSchool(h, {
    name,
    competition: { ageGroups: AGE_GROUPS },
  });
  await setInstitutionFee(h, school, 0n);
  const coordinator = h.as(school.coordinator.actor);
  const ids = {
    institutionId: school.institutionId,
    reference: school.reference,
  };
  return {
    ...school,
    async enrol(student: StudentInput) {
      const result = await coordinator.enrolStudent({ ...ids, student });
      if (!result.ok) throw new Error(`Could not enrol: ${result.error}`);
      return result.registrationId;
    },
    async confirm() {
      const result = await coordinator.payInstitutionFees(ids);
      if (!result.ok || result.kind !== "confirmed_free") {
        throw new Error("Could not confirm the school's registrations");
      }
    },
    async withdraw(registrationId: string) {
      const result = await coordinator.withdrawStudent({
        ...ids,
        registrationId,
      });
      if (!result.ok) throw new Error(`Could not withdraw: ${result.error}`);
    },
  };
}

async function sharedMailboxRoster(h: Harness) {
  const school = await schoolRoster(h);
  await school.enrol(sibling("First Pupil", FAMILY_EMAIL));
  await school.confirm();
  const second = await school.enrol({
    ...sibling("Second Pupil", FAMILY_EMAIL),
    guardianName: "Second Guardian",
    guardianPhone: SECOND_GUARDIAN_PHONE,
  });
  return { competitionId: school.competition.id, second };
}

function guardianDestinations(plan: AudiencePlan) {
  return plan.deliveries
    .filter(({ recipient }) => recipient.roles.includes("guardian"))
    .map(({ channel, address }) => `${channel}:${address}`)
    .sort();
}

function audience(
  h: Harness,
  competitionId: string,
  options: { smsEnabled?: boolean; registrationIds?: ReadonlySet<string> } = {}
) {
  return loadAnnouncementAudience(h.deps, {
    competitionId,
    at: h.clock.now(),
    registrationIds: options.registrationIds,
    channelsForContact: (contact) =>
      planDelivery({
        routeChannels: ["email", "in_app", "sms"],
        requiredByLaw: false,
        preferences:
          contact.kind === "account"
            ? contact.preferences
            : { email: true, sms: true },
        messagesConsent: true,
        smsEnabled: options.smsEnabled ?? false,
        smsTemplateRegistered: true,
        contact: {
          email: contact.email !== null,
          verifiedPhone: contact.phone !== null,
        },
      }).deliver,
  });
}

describe("loadAnnouncementAudience", () => {
  it("keeps both adult roster emails and deduplicates their shared SMS destination", async () => {
    const h = await createHarness();
    const school = await schoolRoster(h);
    await school.enrol({
      fullName: "First Adult",
      dateOfBirth: "2000-01-01",
      email: "first-adult@example.test",
      phone: SHARED_PHONE,
    });
    await school.enrol({
      fullName: "Second Adult",
      dateOfBirth: "2002-01-01",
      email: "second-adult@example.test",
      phone: "90000 00401",
    });
    await school.confirm();

    const messagesBefore = [h.email.sent.length, h.sms.sent.length];
    const plan = await audience(h, school.competition.id, { smsEnabled: true });

    expect(plan.counts).toEqual({
      recipients: 3,
      participants: 2,
      guardians: 0,
      coordinators: 1,
      unreachable: 0,
    });
    expect(
      plan.deliveries
        .filter(({ recipient }) => recipient.roles.includes("participant"))
        .map(({ channel, address }) => `${channel}:${address}`)
        .sort()
    ).toEqual([
      "email:first-adult@example.test",
      "email:second-adult@example.test",
      `sms:${SHARED_PHONE}`,
    ]);
    expect([h.email.sent.length, h.sms.sent.length]).toEqual(messagesBefore);
  });

  it("counts distinct roster guardians who share a mailbox and keeps both SMS destinations", async () => {
    const h = await createHarness();
    const { competitionId } = await sharedMailboxRoster(h);

    const plan = await audience(h, competitionId, { smsEnabled: true });

    expect({
      counts: plan.counts,
      guardianDeliveries: guardianDestinations(plan),
    }).toEqual({
      counts: {
        recipients: 3,
        participants: 0,
        guardians: 2,
        coordinators: 1,
        unreachable: 0,
      },
      guardianDeliveries: [
        `email:${FAMILY_EMAIL}`,
        `sms:${SHARED_PHONE}`,
        `sms:${SECOND_GUARDIAN_PHONE}`,
      ],
    });
  });

  it("preserves both guardians' direct channels after signup with their shared mailbox", async () => {
    const h = await createHarness();
    const { competitionId, second } = await sharedMailboxRoster(h);
    async function plans() {
      const full = await audience(h, competitionId, { smsEnabled: true });
      const subset = await audience(h, competitionId, {
        smsEnabled: true,
        registrationIds: new Set([second]),
      });
      return [full, subset].map((plan) => ({
        counts: plan.counts,
        guardianDeliveries: guardianDestinations(plan),
      }));
    }

    const before = await plans();
    expect(before).toEqual([
      {
        counts: {
          recipients: 3,
          participants: 0,
          guardians: 2,
          coordinators: 1,
          unreachable: 0,
        },
        guardianDeliveries: [
          `email:${FAMILY_EMAIL}`,
          `sms:${SHARED_PHONE}`,
          `sms:${SECOND_GUARDIAN_PHONE}`,
        ],
      },
      {
        counts: {
          recipients: 2,
          participants: 0,
          guardians: 1,
          coordinators: 1,
          unreachable: 0,
        },
        guardianDeliveries: [
          `email:${FAMILY_EMAIL}`,
          `sms:${SECOND_GUARDIAN_PHONE}`,
        ],
      },
    ]);

    const visitor = h.as(h.visitor());
    const signup = {
      intent: "sign-up",
      name: "Listed Guardian",
      email: FAMILY_EMAIL,
    } as const;
    await visitor.requestEmailCode(signup);
    const code = h.email.codeFor(FAMILY_EMAIL);
    if (!code) throw new Error("Expected a signup code in the email fake");
    await expect(
      visitor.verifyEmailCode({ ...signup, code })
    ).resolves.toMatchObject({
      ok: true,
      isNewAccount: true,
    });

    expect(await plans()).toEqual(before);
  });

  it("uses the shared mailbox account only for the guardian with its verified phone", async () => {
    const h = await createHarness();
    const { competitionId, second } = await sharedMailboxRoster(h);
    const first = await h.seed.member({
      name: "Listed Guardian",
      email: FAMILY_EMAIL,
      phone: SHARED_PHONE,
    });

    const full = await audience(h, competitionId, { smsEnabled: true });
    const subset = await audience(h, competitionId, {
      smsEnabled: true,
      registrationIds: new Set([second]),
    });

    expect(
      [full, subset].map((plan) => ({
        recipients: plan.counts.recipients,
        guardians: plan.counts.guardians,
        guardianDeliveries: guardianDestinations(plan),
      }))
    ).toEqual([
      {
        recipients: 3,
        guardians: 2,
        guardianDeliveries: [
          `email:${FAMILY_EMAIL}`,
          `in_app:${first.id}`,
          `sms:${SHARED_PHONE}`,
          `sms:${SECOND_GUARDIAN_PHONE}`,
        ],
      },
      {
        recipients: 2,
        guardians: 1,
        guardianDeliveries: [
          `email:${FAMILY_EMAIL}`,
          `sms:${SECOND_GUARDIAN_PHONE}`,
        ],
      },
    ]);
  });

  it("keeps a listed guardian phone on SMS when another account owns the number", async () => {
    const h = await createHarness();
    await h.seed.member({
      email: "unrelated@example.test",
      phone: SHARED_PHONE,
    });
    const school = await schoolRoster(h);
    await school.enrol(sibling("School Child"));
    await school.confirm();

    const plan = await audience(h, school.competition.id, { smsEnabled: true });

    expect(plan.counts).toEqual({
      recipients: 2,
      participants: 0,
      guardians: 1,
      coordinators: 1,
      unreachable: 0,
    });
    expect(
      plan.deliveries
        .filter(({ recipient }) => recipient.roles.includes("guardian"))
        .map(({ channel, address, recipient }) => [
          channel,
          address,
          recipient.contact.kind,
        ])
    ).toEqual([["sms", SHARED_PHONE, "details"]]);

    const withSmsOff = await audience(h, school.competition.id);

    expect(withSmsOff.counts).toEqual({
      recipients: 1,
      participants: 0,
      guardians: 0,
      coordinators: 1,
      unreachable: 1,
    });
    expect(withSmsOff.unreachable.map(({ reason }) => reason)).toEqual([
      "minor_without_guardian",
    ]);
  });

  it("keeps a matching email awaiting verification on direct contact channels", async () => {
    const h = await createHarness();
    const school = await schoolRoster(h);
    const email = "pending-guardian@example.test";
    const now = h.clock.now();
    await h.db.insert(user).values({
      id: uuidv7(now),
      name: "Pending Guardian",
      email,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    });
    await school.enrol(sibling("School Pupil", email));
    await school.confirm();

    const plan = await audience(h, school.competition.id, { smsEnabled: true });

    expect(
      plan.deliveries
        .filter(({ recipient }) => recipient.roles.includes("guardian"))
        .map(({ channel, address, recipient }) => [
          channel,
          address,
          recipient.contact.kind,
        ])
    ).toEqual([
      ["email", email, "details"],
      ["sms", SHARED_PHONE, "details"],
    ]);
  });

  it("reports only the stable marker and SQLSTATE when a roster lookup fails", async () => {
    const h = await createHarness();
    const school = await schoolRoster(h);
    await school.enrol(sibling("School Pupil", "guardian@example.test"));
    await school.confirm();
    await h.db.execute(
      sql`alter table ${notificationPreference} rename column email to unavailable_email`
    );

    const plan = audience(h, school.competition.id);

    await expect(plan).rejects.toMatchObject({
      message: "announcement_roster_account_lookup_failed (42703)",
    });
    await expect(plan).rejects.not.toHaveProperty("cause");
  });

  it("resolves both siblings to the verified roster email account before counting with SMS off", async () => {
    const h = await createHarness();
    const guardian = await h.seed.member({ email: "guardian@example.test" });
    const school = await schoolRoster(h);
    await school.enrol(sibling("First Sibling", guardian.email));
    const phoneOnly = await school.enrol({
      ...sibling("Second Sibling"),
      guardianName: "listed guardian",
      guardianPhone: "90000 00401",
    });
    await school.confirm();

    const plan = await audience(h, school.competition.id);

    expect(plan.counts).toEqual({
      recipients: 2,
      participants: 0,
      guardians: 1,
      coordinators: 1,
      unreachable: 0,
    });
    expect(plan.unreachable).toEqual([]);
    expect(
      plan.deliveries
        .filter(({ recipient }) => recipient.roles.includes("guardian"))
        .map(({ channel, address }) => `${channel}:${address}`)
    ).toEqual([`email:${guardian.email}`, `in_app:${guardian.id}`]);

    const subset = await audience(h, school.competition.id, {
      registrationIds: new Set([phoneOnly]),
    });
    expect(subset.counts).toMatchObject({
      recipients: 1,
      guardians: 0,
      unreachable: 1,
    });
  });

  it("keeps each verified guardian's channels when a shared alias has conflicting emails", async () => {
    const h = await createHarness();
    const first = await h.seed.member({
      email: "first-guardian@example.test",
      phone: SHARED_PHONE,
    });
    const second = await h.seed.member({
      email: "second-guardian@example.test",
    });
    const school = await schoolRoster(h);
    await school.enrol(sibling("First Pupil", first.email));
    await school.enrol(sibling("Second Pupil", second.email));
    await school.enrol(sibling("Third Pupil"));
    await school.confirm();

    const plan = await audience(h, school.competition.id);

    expect(plan.counts).toEqual({
      recipients: 3,
      participants: 0,
      guardians: 2,
      coordinators: 1,
      unreachable: 1,
    });
    expect(
      plan.deliveries
        .filter(({ recipient }) => recipient.roles.includes("guardian"))
        .map(({ channel, address }) => `${channel}:${address}`)
        .sort()
    ).toEqual([
      `email:${first.email}`,
      `email:${second.email}`,
      ...[`in_app:${first.id}`, `in_app:${second.id}`].sort(),
    ]);
  });

  it("selects an active verified guardian link and uses roster channels after revocation", async () => {
    const h = await createHarness();
    const family = await h.seed.guardian({ children: [] });
    const school = await schoolRoster(h);
    const registrationId = await school.enrol(sibling("Linked Pupil"));
    await school.confirm();
    const [row] = await h.db
      .select({ profileId: registration.participantProfileId })
      .from(registration)
      .where(eq(registration.id, registrationId));
    const now = h.clock.now();
    const id = uuidv7(now);
    await h.db.insert(guardianLink).values({
      id,
      guardianId: family.guardianId,
      participantProfileId: row!.profileId,
      relationship: "parent",
      createdAt: now,
    });

    const linked = await audience(h, school.competition.id);
    expect(linked.counts).toMatchObject({ guardians: 1, unreachable: 0 });
    expect(
      linked.deliveries
        .filter(({ recipient }) => recipient.roles.includes("guardian"))
        .map(({ channel, address }) => `${channel}:${address}`)
    ).toEqual([`email:${family.account.email}`, `in_app:${family.account.id}`]);

    await h.db
      .update(guardianLink)
      .set({ revokedAt: now })
      .where(eq(guardianLink.id, id));
    const revoked = await audience(h, school.competition.id, {
      smsEnabled: true,
    });
    expect(revoked.counts).toMatchObject({ guardians: 1, unreachable: 0 });
    expect(
      revoked.deliveries
        .filter(({ recipient }) => recipient.roles.includes("guardian"))
        .map(({ channel, address }) => `${channel}:${address}`)
    ).toEqual([`sms:${SHARED_PHONE}`]);
  });

  it("routes a confirmed individual to their guardian before their 18th birthday in India", async () => {
    const h = await createHarness();
    h.clock.set("2026-02-14T06:00:00Z");
    const teen = await h.seed.member({ email: "teen@example.test" });
    const family = await h.seed.guardian({
      children: [
        { fullName: "Teen Participant", age: 17, loginUserId: teen.id },
      ],
    });
    h.clock.set("2027-01-14T18:20:00Z");
    const competition = await openToIndividuals(h, {
      fee: 0n,
      ageGroups: AGE_GROUPS,
    });
    const guardian = h.as(await h.signIn(family.account));
    const {
      fullName: _name,
      dateOfBirth: _birth,
      ...form
    } = adultForm(competition);
    const registered = await guardian.registerAsIndividual({
      ...form,
      forChildId: family.childIds[0]!,
    });
    if (!registered.ok)
      throw new Error(`Could not register: ${registered.error}`);
    const paid = await guardian.payForMyRegistration({
      registrationId: registered.registrationId,
    });
    if (!paid.ok || paid.kind !== "confirmed_free")
      throw new Error("Could not confirm the registration");
    const unconfirmed = h.as(await h.signIn(await h.seed.member()));
    await expect(
      unconfirmed.registerAsIndividual(adultForm(competition))
    ).resolves.toMatchObject({
      ok: true,
      status: "pending_payment",
    });

    const before = await audience(h, competition.id);
    expect(before.counts).toMatchObject({
      recipients: 1,
      guardians: 1,
      participants: 0,
      unreachable: 0,
    });
    expect(
      before.deliveries.map(({ channel, address }) => `${channel}:${address}`)
    ).toEqual([`email:${family.account.email}`, `in_app:${family.account.id}`]);

    h.clock.advance({ minutes: 10 });
    const after = await audience(h, competition.id);
    expect(after.counts).toMatchObject({
      recipients: 1,
      guardians: 0,
      participants: 1,
      unreachable: 0,
    });
    expect(
      after.deliveries.map(({ channel, address }) => `${channel}:${address}`)
    ).toEqual([`email:${teen.email}`, `in_app:${teen.id}`]);
  });

  it("uses the independently listed guardian email when a known minor owns the roster phone", async () => {
    const h = await createHarness();
    const teen = await h.seed.member({
      email: "teen@example.test",
      phone: SHARED_PHONE,
    });
    await h.seed.guardian({
      children: [
        { fullName: "Teen Participant", age: 15, loginUserId: teen.id },
      ],
    });
    const school = await schoolRoster(h);
    await school.enrol(sibling("School Pupil", "roster-guardian@example.test"));
    await school.confirm();

    const plan = await audience(h, school.competition.id, { smsEnabled: true });

    expect(plan.counts).toMatchObject({ guardians: 1, unreachable: 0 });
    expect(
      plan.deliveries
        .filter(({ recipient }) => recipient.roles.includes("guardian"))
        .map(({ channel, address }) => `${channel}:${address}`)
    ).toEqual(["email:roster-guardian@example.test"]);
  });

  it("uses the independently listed guardian phone when a known minor owns the roster email", async () => {
    const h = await createHarness();
    const teen = await h.seed.member({ email: "teen@example.test" });
    await h.seed.guardian({
      children: [
        { fullName: "Teen Participant", age: 15, loginUserId: teen.id },
      ],
    });
    const school = await schoolRoster(h);
    await school.enrol(sibling("School Pupil", teen.email));
    await school.confirm();

    const plan = await audience(h, school.competition.id, { smsEnabled: true });

    expect(plan.counts).toMatchObject({ guardians: 1, unreachable: 0 });
    expect(guardianDestinations(plan)).toEqual([`sms:${SHARED_PHONE}`]);
  });

  it("selects only eligible roster rows and their coordinators for a registration subset", async () => {
    const h = await createHarness();
    const school = await schoolRoster(h);
    await school.enrol(sibling("Confirmed Pupil", "confirmed@example.test"));
    await school.confirm();
    const due = await school.enrol(
      sibling("Enrolled Pupil", "due@example.test")
    );
    const withdrawn = await school.enrol(
      sibling("Withdrawn Pupil", "withdrawn@example.test")
    );
    await school.withdraw(withdrawn);
    const other = await schoolRoster(h, "Another School");
    const foreign = await other.enrol(
      sibling("Foreign Pupil", "foreign@example.test")
    );
    expect((await audience(h, other.competition.id)).recipients).toEqual([]);
    await other.confirm();

    const plan = await audience(h, school.competition.id, {
      registrationIds: new Set([due, withdrawn, foreign]),
    });

    expect(plan.counts).toEqual({
      recipients: 2,
      participants: 0,
      guardians: 1,
      coordinators: 1,
      unreachable: 0,
    });
    expect(
      plan.deliveries.map(({ channel, address, recipient }) => [
        channel,
        address,
        recipient.roles,
      ])
    ).toEqual([
      ["email", "due@example.test", ["guardian"]],
      ["email", expect.any(String), ["coordinator"]],
      ["in_app", school.coordinator.userId, ["coordinator"]],
    ]);
    const empty = await audience(h, school.competition.id, {
      registrationIds: new Set(),
    });
    expect(empty.counts).toEqual({
      recipients: 0,
      participants: 0,
      guardians: 0,
      coordinators: 0,
      unreachable: 0,
    });
  });
});

describe("planAnnouncementAudience", () => {
  it("resolves a sibling's guardian alias after the contact is copied", () => {
    const phone = parsePhoneNumber(SHARED_PHONE);
    if (!phone.ok) throw new Error("Expected a valid fixture phone");
    const phoneOnly = {
      kind: "details",
      name: "Listed Guardian",
      email: null,
      phone: phone.e164,
    } as const;
    const alias = rosterGuardianPhoneAlias(phoneOnly);
    if (alias === null) throw new Error("Expected a fixture guardian alias");
    const verified = {
      kind: "account",
      userId: "verified-guardian",
      name: "Listed Guardian",
      email: "guardian@example.test",
      phone: null,
      preferences: { email: true, sms: true },
    } as const;
    const candidates: Candidate[] = [
      {
        role: "guardian",
        participantProfileId: "first-sibling",
        contacts: [verified],
        roster: { alias, listedEmail: verified.email, contactIndex: 0 },
      },
      {
        role: "guardian",
        participantProfileId: "second-sibling",
        contacts: [{ ...phoneOnly }],
        roster: { alias, listedEmail: null, contactIndex: 0 },
      },
    ];

    const plan = planAnnouncementAudience(candidates, () => [
      "email",
      "in_app",
    ]);

    expect(plan.counts).toMatchObject({ guardians: 1, unreachable: 0 });
  });
});
