import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  competitionAgeGroup,
  guardianInvitation,
  participantProfile,
  registration,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { bornYearsAgo } from "@/server/modules/guardians/testing";
import { createHarness, type Harness } from "@/test/harness";

import {
  adultForm,
  openToIndividuals,
  participantRows,
  type OpenCompetition,
} from "./testing";

// #81: a minor takes part on the individual route with a guardian. A
// verified guardian registers their child; a linked teen registers
// themselves; a child under 13 never registers alone.

const PARTICIPANT_ID = /^FOA-P-\d{2}[0-9A-HJKMNP-TV-Z]{6}$/;

/** Children's, teens' and adults' groups, counted on 1 June 2027. */
const ALL_AGES = [
  { label: "6–12", minAge: 6, maxAge: 12 },
  { label: "13–17", minAge: 13, maxAge: 17 },
  { label: "Adults", minAge: 18, maxAge: 99 },
];

function openToAllAges(h: Harness) {
  return openToIndividuals(h, { ageGroups: ALL_AGES });
}

/** The id of the competition's age group with this label. */
async function groupId(h: Harness, competitionId: string, label: string) {
  const [group] = await h.db
    .select({ id: competitionAgeGroup.id })
    .from(competitionAgeGroup)
    .where(
      and(
        eq(competitionAgeGroup.competitionId, competitionId),
        eq(competitionAgeGroup.label, label)
      )
    );
  if (!group) throw new Error(`No age group ${label}`);
  return group.id;
}

/** What a 15-year-old with no guardian on the platform types. */
function teenForm(
  h: Harness,
  competition: OpenCompetition,
  guardian?: { fullName: string; relationship: string; email: string }
) {
  return {
    ...adultForm(competition, {
      fullName: "Meera Iyer",
      dateOfBirth: bornYearsAgo(h, 15, 30),
    }),
    ...(guardian ? { guardian } : {}),
  };
}

const MOTHER = {
  fullName: "Lakshmi Iyer",
  relationship: "parent",
  email: "Lakshmi.Iyer@Example.test",
};

const LINK = /\/invitations\/[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;

/** The form a guardian sends for their child: no name or date of birth. */
function childForm(competition: OpenCompetition, childId: string) {
  const { fullName: _name, dateOfBirth: _dob, ...form } =
    adultForm(competition);
  return { ...form, forChildId: childId };
}

describe("registerAsIndividual for a minor", () => {
  it("lets a verified guardian register their 9-year-old, waiting for payment", async () => {
    const h = await createHarness();
    const competition = await openToAllAges(h);
    const family = await h.seed.guardian({
      name: "Kavita Desai",
      children: [{ fullName: "Isha Desai", age: 9 }],
    });
    const kavita = await h.signIn(family.account);

    const result = await h
      .as(kavita)
      .registerAsIndividual(childForm(competition, family.childIds[0]!));

    expect(result).toEqual({
      ok: true,
      registrationId: expect.any(String),
      participantCode: expect.stringMatching(PARTICIPANT_ID),
      status: "pending_payment",
    });
    if (!result.ok) return;
    const [saved] = await h.db
      .select()
      .from(registration)
      .where(eq(registration.id, result.registrationId));
    expect(saved).toMatchObject({
      participantProfileId: family.childIds[0],
      status: "pending_payment",
    });
    // The child's profile, still the guardian's, now has its Participant ID.
    const [child] = await h.db
      .select()
      .from(participantProfile)
      .where(eq(participantProfile.id, family.childIds[0]!));
    expect(child).toMatchObject({
      ownerKind: "guardian",
      ownerUserId: family.account.id,
      fullName: "Isha Desai",
      participantCode: result.participantCode,
    });
    expect((await participantRows(h)).profiles).toHaveLength(1);
  });

  it("lets a linked teen register themselves on their child profile, whatever date of birth they type", async () => {
    const h = await createHarness();
    const competition = await openToAllAges(h);
    const teen = await h.seed.member({ name: "Rohan Desai" });
    const family = await h.seed.guardian({
      children: [{ fullName: "Rohan Desai", age: 15, loginUserId: teen.id }],
    });
    const rohan = await h.signIn(teen);

    const result = await h
      .as(rohan)
      .registerAsIndividual(
        adultForm(competition, { fullName: "Rohan", dateOfBirth: "1990-01-01" })
      );

    expect(result).toMatchObject({ ok: true, status: "pending_payment" });
    if (!result.ok) return;
    const { profiles, registrations } = await participantRows(h);
    // No profile of their own: the guardian's child profile, its name kept.
    expect(profiles).toEqual([
      expect.objectContaining({
        id: family.childIds[0],
        ownerKind: "guardian",
        loginUserId: teen.id,
        fullName: "Rohan Desai",
      }),
    ]);
    expect(registrations).toEqual([
      expect.objectContaining({
        participantProfileId: family.childIds[0],
        // Placed by the profile's date of birth: 15, in the teens' group.
        ageGroupId: await groupId(h, competition.id, "13–17"),
      }),
    ]);
  });

  it("never lets a child under 13 register alone, and writes nothing", async () => {
    const h = await createHarness();
    const competition = await openToAllAges(h);
    const child = await h.seed.member({ name: "Isha" });
    const isha = await h.signIn(child);
    const before = await participantRows(h);

    const result = await h.as(isha).registerAsIndividual(
      adultForm(competition, { dateOfBirth: bornYearsAgo(h, 12, 300) })
    );

    expect(result).toEqual({ ok: false, error: "under_13_needs_guardian" });
    expect(await participantRows(h)).toEqual(before);
  });

  it("refuses a guardian registering a child who has turned 18", async () => {
    const h = await createHarness();
    const competition = await openToAllAges(h);
    const family = await h.seed.guardian({
      children: [{ fullName: "Arjun Rao", age: 18 }],
    });
    const parent = await h.signIn(family.account);

    expect(
      await h
        .as(parent)
        .registerAsIndividual(childForm(competition, family.childIds[0]!))
    ).toEqual({ ok: false, error: "adult_registers_self" });
    expect((await participantRows(h)).registrations).toEqual([]);
  });

  describe("a teen with no guardian on the platform", () => {
    it("is held for the guardian they name, who is emailed a link", async () => {
      const h = await createHarness();
      const competition = await openToAllAges(h);
      const teen = await h.seed.member({ name: "Meera Iyer" });
      const meera = await h.signIn(teen);

      const result = await h
        .as(meera)
        .registerAsIndividual(teenForm(h, competition, MOTHER));

      expect(result).toEqual({
        ok: true,
        registrationId: expect.any(String),
        participantCode: expect.stringMatching(PARTICIPANT_ID),
        status: "pending_guardian",
      });
      expect(await h.as(meera).listMyRegistrations()).toEqual([
        expect.objectContaining({ status: "pending_guardian", amountDue: null }),
      ]);
      await h.drain();
      const sent = h.email.sent.filter(
        (message) => message.to === "lakshmi.iyer@example.test"
      );
      expect(sent).toHaveLength(1);
      expect(sent[0]!.subject).toBe(
        "Please confirm you are a parent or guardian on Friends of Animals"
      );
      expect(sent[0]!.text).toContain("Hello Lakshmi Iyer");
      expect(sent[0]!.text).toContain("Meera Iyer has registered");
      expect(sent[0]!.text).toMatch(LINK);
    });

    it("keeps the guardian's name and address encrypted, the token only as a hash", async () => {
      const h = await createHarness();
      const competition = await openToAllAges(h);
      const meera = await h.signIn(await h.seed.member({ name: "Meera" }));

      await h.as(meera).registerAsIndividual(teenForm(h, competition, MOTHER));

      const [request] = await h.db.select().from(guardianInvitation);
      expect(request).toMatchObject({
        kind: "guardian_request",
        guardianId: null,
        relationship: "parent",
        status: "pending",
      });
      const stored = JSON.stringify(request);
      expect(stored).not.toContain("Lakshmi");
      expect(stored.toLowerCase()).not.toContain("lakshmi.iyer@example.test");
      expect(request!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("refuses naming one of their own addresses as the guardian's, writing nothing", async () => {
      const h = await createHarness();
      const competition = await openToAllAges(h);
      const teen = await h.seed.member({ email: "meera@example.test" });
      const meera = await h.signIn(teen);
      const before = await participantRows(h);

      const result = await h.as(meera).registerAsIndividual(
        teenForm(h, competition, { ...MOTHER, email: "Meera@example.test" })
      );

      expect(result).toEqual({ ok: false, error: "guardian_contact_is_self" });
      expect(await participantRows(h)).toEqual(before);
      expect(await h.db.select().from(guardianInvitation)).toEqual([]);
    });

    it("is asked for a guardian when they name nobody, and for each field at fault", async () => {
      const h = await createHarness();
      const competition = await openToAllAges(h);
      const meera = await h.signIn(await h.seed.member());
      const before = await participantRows(h);

      expect(
        await h.as(meera).registerAsIndividual(teenForm(h, competition))
      ).toEqual({ ok: false, error: "guardian_details_required" });
      expect(
        await h.as(meera).registerAsIndividual(
          teenForm(h, competition, {
            fullName: "L",
            relationship: "aunt",
            email: "not an address",
          })
        )
      ).toEqual({
        ok: false,
        error: "invalid_input",
        fields: ["guardianName", "guardianRelationship", "guardianEmail"],
      });
      expect(await participantRows(h)).toEqual(before);
    });

    it("asks the same guardian once for a second competition", async () => {
      const h = await createHarness();
      const first = await openToAllAges(h);
      const second = await openToAllAges(h);
      const meera = await h.signIn(await h.seed.member());

      await h.as(meera).registerAsIndividual(teenForm(h, first, MOTHER));
      const again = await h
        .as(meera)
        .registerAsIndividual(teenForm(h, second));
      await h.drain();

      expect(again).toMatchObject({ ok: true, status: "pending_guardian" });
      expect(
        h.email.sent.filter((m) => m.to === "lakshmi.iyer@example.test")
      ).toHaveLength(1);
      expect(await h.db.select().from(guardianInvitation)).toHaveLength(1);
    });
  });

  describe("who may register whom", () => {
    it("refuses a teen registering a sibling or anyone else's child", async () => {
      const h = await createHarness();
      const competition = await openToAllAges(h);
      const teen = await h.seed.member({ name: "Rohan" });
      const family = await h.seed.guardian({
        children: [
          { fullName: "Rohan Desai", age: 15, loginUserId: teen.id },
          { fullName: "Isha Desai", age: 9 },
        ],
      });
      const rohan = await h.signIn(teen);

      await expect(
        h
          .as(rohan)
          .registerAsIndividual(childForm(competition, family.childIds[1]!))
      ).rejects.toThrow(DomainError);
      expect((await participantRows(h)).registrations).toEqual([]);
    });

    it("refuses one guardian registering another guardian's child", async () => {
      const h = await createHarness();
      const competition = await openToAllAges(h);
      const a = await h.seed.guardian({
        children: [{ fullName: "Isha Desai", age: 9 }],
      });
      const b = await h.seed.guardian({ children: [] });
      const other = await h.signIn(b.account);

      await expect(
        h.as(other).registerAsIndividual(childForm(competition, a.childIds[0]!))
      ).rejects.toThrow(DomainError);
      await expect(
        h
          .as(other)
          .registerAsIndividual(childForm(competition, "not-a-profile-id"))
      ).rejects.toThrow(DomainError);
      expect((await participantRows(h)).registrations).toEqual([]);
    });

    it("refuses a visitor", async () => {
      const h = await createHarness();
      const competition = await openToAllAges(h);
      const family = await h.seed.guardian({
        children: [{ fullName: "Isha Desai", age: 9 }],
      });

      await expect(
        h
          .as(h.visitor())
          .registerAsIndividual(childForm(competition, family.childIds[0]!))
      ).rejects.toThrow(DomainError);
    });
  });
});
