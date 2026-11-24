import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import {
  auditLog,
  participantProfile,
  registration,
  user,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { signedInStaff } from "@/server/modules/institutions/testing";
import { createHarness, type Harness } from "@/test/harness";
import { seedInstitution } from "@/test/institutions";

import {
  AANYA,
  registeredSchool,
  signInCoordinator,
  STUDENT_AGE_CUTOFF,
  STUDENT_AGE_GROUPS,
} from "./testing";

async function counts(h: Harness) {
  const profiles = await h.db.select().from(participantProfile);
  const registrations = await h.db.select().from(registration);
  return { profiles: profiles.length, registrations: registrations.length };
}

const NOTHING = { profiles: 0, registrations: 0 };

describe("enrolStudent", () => {
  it("enrols a child: one profile the institution manages and one registration in the right age group", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);

    const result = await h.as(school.coordinator.actor).enrolStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      student: AANYA,
    });

    const seniors = school.group("10–13");
    expect(result).toEqual({
      ok: true,
      registrationId: expect.any(String),
      ageGroup: seniors,
      ignored: [],
    });
    if (!result.ok) return;
    const [profile] = await h.db.select().from(participantProfile);
    expect(profile).toMatchObject({
      ownerKind: "institution",
      managingInstitutionId: school.institutionId,
      fullName: "Aanya Rao",
      grade: "Class 4",
      studentRef: null,
      guardianRelationship: "parent",
      // Nothing given, so the institution's (validRegistration's).
      pinCode: "411001",
      city: "Pune",
      state: "Maharashtra",
      phoneCiphertext: null,
      emailCiphertext: null,
      createdBy: school.coordinator.userId,
      createdAt: h.clock.now(),
    });
    expect(await h.db.select().from(registration)).toEqual([
      {
        id: result.registrationId,
        participantProfileId: profile!.id,
        competitionId: school.competition.id,
        route: "institution",
        institutionRegistrationId: school.registrationId,
        ageGroupId: seniors.id,
        status: "enrolled",
        // Given once the fee is paid (#77).
        registrationNumber: null,
        createdAt: h.clock.now(),
        updatedAt: h.clock.now(),
      },
    ]);
  });

  it.each([
    ["10 on the cut-off day", "2017-06-01", "10–13"],
    ["9 on the cut-off day, 10 the day after", "2017-06-02", "6–9"],
    ["exactly 6", "2021-06-01", "6–9"],
    ["13, turning 14 the day after", "2013-06-02", "10–13"],
  ])(
    "places a student %s by their age on the cut-off date",
    async (_case, dateOfBirth, label) => {
      const h = await createHarness();
      const school = await registeredSchool(h);

      const result = await h.as(school.coordinator.actor).enrolStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        student: { ...AANYA, dateOfBirth },
      });

      expect(result).toMatchObject({ ok: true, ageGroup: school.group(label) });
    }
  );

  it("refuses a student outside every age group, with their age, the groups and the cut-off, and writes nothing", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);

    const result = await h.as(school.coordinator.actor).enrolStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      student: { ...AANYA, dateOfBirth: "2013-06-01" },
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_student",
      problems: [
        {
          field: "dateOfBirth",
          code: "outside_age_groups",
          age: 14,
          groups: STUDENT_AGE_GROUPS.map((group) => ({
            ...group,
            id: school.group(group.label).id,
          })),
          ageCutoffDate: STUDENT_AGE_CUTOFF,
        },
      ],
    });
    expect(await counts(h)).toEqual(NOTHING);
  });

  it("reports each field's problem at once and writes nothing", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);

    const result = await h.as(school.coordinator.actor).enrolStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      student: {
        fullName: "A",
        dateOfBirth: "2017-06-01",
        guardianRelationship: "uncle",
        guardianPhone: "12345",
        pinCode: "011001",
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_student",
      problems: expect.arrayContaining([
        { field: "fullName", code: "too_short" },
        { field: "pinCode", code: "invalid_format" },
        { field: "guardianName", code: "required" },
        { field: "guardianRelationship", code: "invalid_choice" },
        { field: "guardianPhone", code: "invalid_phone" },
      ]),
    });
    expect(
      result.ok === false && "problems" in result && result.problems
    ).toHaveLength(5);
    expect(await counts(h)).toEqual(NOTHING);
  });

  it("reports a hidden control character, such as a NUL, as that field's problem, never a database error", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);

    const result = await h.as(school.coordinator.actor).enrolStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      student: {
        ...AANYA,
        fullName: "Aanya\u0000Rao",
        guardianEmail: "kavita\u0000@example.test",
        city: "Pune\u0007",
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_student",
      problems: expect.arrayContaining([
        { field: "fullName", code: "invalid_characters" },
        { field: "guardianEmail", code: "invalid_characters" },
        { field: "city", code: "invalid_characters" },
      ]),
    });
    expect(
      result.ok === false && "problems" in result && result.problems
    ).toHaveLength(3);
    expect(await counts(h)).toEqual(NOTHING);
  });

  it("asks an adult student for their own phone, and drops a guardian's details given for them", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h, {
      competition: {
        ageGroups: [{ label: "18–25", minAge: 18, maxAge: 25 }],
      },
    });
    const adult = {
      fullName: "Rahul Verma",
      dateOfBirth: "2005-03-10",
      guardianName: "Sunil Verma",
      guardianRelationship: "parent",
      guardianPhone: "90000 00302",
    };

    const withoutPhone = await h.as(school.coordinator.actor).enrolStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      student: adult,
    });
    const withPhone = await h.as(school.coordinator.actor).enrolStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      student: { ...adult, phone: "90000 00303" },
    });

    expect(withoutPhone).toEqual({
      ok: false,
      error: "invalid_student",
      problems: [{ field: "phone", code: "required" }],
    });
    expect(withPhone).toMatchObject({
      ok: true,
      ignored: ["guardianName", "guardianRelationship", "guardianPhone"],
    });
    const [profile] = await h.db.select().from(participantProfile);
    expect(profile).toMatchObject({
      guardianNameCiphertext: null,
      guardianRelationship: null,
      guardianPhoneCiphertext: null,
    });
    expect(
      h.deps.cipher.decrypt(
        "participant_profile.phone",
        profile!.phoneCiphertext!
      )
    ).toBe("+919000000303");
  });

  it("stores the date of birth, phones, emails, guardian's name and address encrypted, readable only through the cipher", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    await h.as(school.coordinator.actor).enrolStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      student: AANYA,
    });

    const { rows } = await h.db.execute(sql`SELECT * FROM participant_profile`);
    const raw = JSON.stringify(rows);

    for (const plain of [
      "2017-06-01",
      "Kavita Rao",
      "+919000000301",
      "9000000301",
      "kavita.rao@example.test",
      "Banyan Lane",
    ]) {
      expect(raw).not.toContain(plain);
    }
    const [profile] = await h.db.select().from(participantProfile);
    const read = (purpose: string, stored: string | null) =>
      stored === null ? null : h.deps.cipher.decrypt(purpose, stored);
    expect({
      dob: read("participant_profile.dob", profile!.dobCiphertext),
      guardianName: read(
        "participant_profile.guardian_name",
        profile!.guardianNameCiphertext
      ),
      guardianPhone: read(
        "participant_profile.guardian_phone",
        profile!.guardianPhoneCiphertext
      ),
      guardianEmail: read(
        "participant_profile.guardian_email",
        profile!.guardianEmailCiphertext
      ),
      address: read("participant_profile.address", profile!.addressCiphertext),
    }).toEqual({
      dob: "2017-06-01",
      guardianName: "Kavita Rao",
      guardianPhone: "+919000000301",
      guardianEmail: "kavita.rao@example.test",
      address: "4 Banyan Lane, Kothrud",
    });
    expect(
      await h.db.select().from(user).where(eq(user.email, AANYA.guardianEmail))
    ).toHaveLength(0);

    const staff = await signedInStaff(h);
    const { entries } = await h.as(staff).getInventory();
    expect(
      entries.filter(
        ({ table, column }) =>
          table === "participant_profile" && column.startsWith("guardian_")
      )
    ).toMatchObject(
      [
        "guardian_email_ciphertext",
        "guardian_name_ciphertext",
        "guardian_phone_ciphertext",
        "guardian_relationship",
      ].map((column) => ({
        column,
        subject: {
          kind: "guardian_contact",
          via: "participant_profile.guardian_phone_ciphertext or participant_profile.guardian_email_ciphertext",
        },
        retention: { policy: "participants" },
        onExpiry: "delete_row",
      }))
    );
    const catalogue = JSON.stringify(entries);
    for (const value of [
      AANYA.guardianName,
      "+919000000301",
      AANYA.guardianEmail,
    ]) {
      expect(catalogue).not.toContain(value);
    }
  });

  describe("the same student twice", () => {
    it("refuses the same child spelled another way, or with the date written day first", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const coordinator = h.as(school.coordinator.actor);
      const enrol = (student: typeof AANYA) =>
        coordinator.enrolStudent({
          institutionId: school.institutionId,
          reference: school.reference,
          student,
        });
      await enrol(AANYA);

      const again = await enrol({
        ...AANYA,
        fullName: " aanyá  RAO",
        dateOfBirth: "01/06/2017",
      });

      expect(again).toEqual({ ok: false, error: "already_enrolled" });
      expect(await counts(h)).toEqual({ profiles: 1, registrations: 1 });
    });

    it("refuses another name under a roll number already enrolled", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const coordinator = h.as(school.coordinator.actor);
      await coordinator.enrolStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        student: { ...AANYA, studentRef: "4b-07" },
      });

      const again = await coordinator.enrolStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        student: { ...AANYA, fullName: "Anya R", studentRef: " 4B-07 " },
      });

      expect(again).toEqual({ ok: false, error: "already_enrolled" });
    });

    it("enrols a twin: same date of birth, another name", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const coordinator = h.as(school.coordinator.actor);
      await coordinator.enrolStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        student: AANYA,
      });

      const twin = await coordinator.enrolStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        student: { ...AANYA, fullName: "Ishaan Rao" },
      });

      expect(twin).toMatchObject({ ok: true });
      expect(await counts(h)).toEqual({ profiles: 2, registrations: 2 });
    });

    it("lets another institution enrol a child with the same name and date of birth", async () => {
      const h = await createHarness();
      const x = await registeredSchool(h, { name: "X" });
      await h.as(x.coordinator.actor).enrolStudent({
        institutionId: x.institutionId,
        reference: x.reference,
        student: AANYA,
      });
      const { institution: y } = await seedInstitution(h, { name: "Y" });
      const { actor: forY } = await signInCoordinator(h, y.id);
      const registered = await h.as(forY).registerInstitutionForCompetition({
        institutionId: y.id,
        competitionId: x.competition.id,
      });
      if (!registered.ok) throw new Error(registered.error);

      const result = await h.as(forY).enrolStudent({
        institutionId: y.id,
        reference: registered.reference,
        student: AANYA,
      });

      expect(result).toMatchObject({ ok: true });
      expect(await counts(h)).toEqual({ profiles: 2, registrations: 2 });
    });

    it("keeps one profile per child at an institution, enrolling them in a second competition", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const second = await h.seed.competition({
        status: "registration_open",
        participation: "institutions",
        ageGroups: STUDENT_AGE_GROUPS,
        ageCutoffDate: STUDENT_AGE_CUTOFF,
      });
      const coordinator = h.as(school.coordinator.actor);
      const registered = await coordinator.registerInstitutionForCompetition({
        institutionId: school.institutionId,
        competitionId: second.id,
      });
      if (!registered.ok) throw new Error(registered.error);
      await coordinator.enrolStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        student: AANYA,
      });

      const result = await coordinator.enrolStudent({
        institutionId: school.institutionId,
        reference: registered.reference,
        student: { ...AANYA, guardianPhone: "90000 00309" },
      });

      expect(result).toMatchObject({ ok: true });
      expect(await counts(h)).toEqual({ profiles: 1, registrations: 2 });
      const [profile] = await h.db.select().from(participantProfile);
      // The latest details the institution gave.
      expect(
        h.deps.cipher.decrypt(
          "participant_profile.guardian_phone",
          profile!.guardianPhoneCiphertext!
        )
      ).toBe("+919000000309");
    });
  });

  describe("the registration it is for", () => {
    it("refuses before registration opens and after it closes", async () => {
      const h = await createHarness();
      const { institution: x } = await seedInstitution(h);
      const { actor } = await signInCoordinator(h, x.id);
      const published = await h.seed.competition({
        status: "published",
        participation: "institutions",
        ageGroups: STUDENT_AGE_GROUPS,
        ageCutoffDate: STUDENT_AGE_CUTOFF,
      });
      const early = await h.seed.institutionRegistration({
        institutionId: x.id,
        competitionId: published.id,
      });
      const school = await registeredSchool(h, { name: "Late School" });

      const before = await h.as(actor).enrolStudent({
        institutionId: x.id,
        reference: early.reference,
        student: AANYA,
      });
      // openCompetition's registration closes 55 days after the clock.
      h.clock.advance({ days: 56 });
      const after = await h.as(school.coordinator.actor).enrolStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        student: AANYA,
      });

      expect(before).toEqual({ ok: false, error: "not_open_yet" });
      expect(after).toEqual({ ok: false, error: "closed" });
      expect(await counts(h)).toEqual(NOTHING);
    });

    it("finds no registration under an unknown reference, or another institution's", async () => {
      const h = await createHarness();
      const x = await registeredSchool(h, { name: "X" });
      const y = await registeredSchool(h, { name: "Y" });

      for (const reference of ["NOPE27-I-00000", y.reference]) {
        expect(
          await h.as(x.coordinator.actor).enrolStudent({
            institutionId: x.institutionId,
            reference,
            student: AANYA,
          })
        ).toEqual({ ok: false, error: "not_found" });
      }
      expect(await counts(h)).toEqual(NOTHING);
    });

    it("refuses while the institution is suspended", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const staff = h.as(await signedInStaff(h));
      const suspended = await staff.decideInstitution({
        institutionId: school.institutionId,
        decision: "suspend",
        reason: "Checking the school's records again",
      });
      if (!suspended.ok) throw new Error(suspended.error);

      const result = await h.as(school.coordinator.actor).enrolStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        student: AANYA,
      });

      expect(result).toEqual({ ok: false, error: "institution_not_verified" });
      expect(await counts(h)).toEqual(NOTHING);
    });
  });

  describe("the audit log", () => {
    it("records each enrolment by ids, with who did it and from where", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h, {
        coordinatorMeta: { ip: "198.51.100.7", userAgent: "Staffroom browser" },
      });

      const result = await h.as(school.coordinator.actor).enrolStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        student: AANYA,
      });
      if (!result.ok) throw new Error(result.error);

      const [profile] = await h.db.select().from(participantProfile);
      expect(
        await h.db
          .select()
          .from(auditLog)
          .where(eq(auditLog.action, "registration.student_enrolled"))
      ).toEqual([
        expect.objectContaining({
          actorKind: "user",
          actorUserId: school.coordinator.userId,
          actorRole: "institution_coordinator",
          entityType: "registration",
          entityId: result.registrationId,
          before: null,
          after: {
            participantProfileId: profile!.id,
            institutionRegistrationId: school.registrationId,
            competitionId: school.competition.id,
            ageGroupId: school.group("10–13").id,
            status: "enrolled",
          },
          ip: "198.51.100.7",
          userAgent: "Staffroom browser",
          occurredAt: h.clock.now(),
        }),
      ]);
    });

    it("records nothing when it refuses", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);

      await h.as(school.coordinator.actor).enrolStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        student: { ...AANYA, dateOfBirth: "2013-06-01" },
      });

      expect(
        await h.db
          .select()
          .from(auditLog)
          .where(eq(auditLog.action, "registration.student_enrolled"))
      ).toEqual([]);
    });
  });

  describe("who may enrol", () => {
    it("lets the institution's authorised person enrol", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const authorisedPerson = await h.signIn(school.admin);

      const result = await h.as(authorisedPerson).enrolStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        student: AANYA,
      });

      expect(result).toMatchObject({ ok: true });
    });

    const OUTSIDERS: [string, (h: Harness) => Promise<Actor>][] = [
      [
        "a coordinator of another institution",
        async (h) => {
          const { institution: y } = await seedInstitution(h, { name: "Y" });
          return (await signInCoordinator(h, y.id)).actor;
        },
      ],
      ["a member", async (h) => h.signIn(await h.seed.member())],
      ["a staff admin", (h) => signedInStaff(h)],
      ["a visitor", async (h) => h.visitor()],
    ];

    it.each(OUTSIDERS)("refuses %s", async (_who, actorFor) => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const actor = await actorFor(h);

      await expect(
        h.as(actor).enrolStudent({
          institutionId: school.institutionId,
          reference: school.reference,
          student: AANYA,
        })
      ).rejects.toThrow(DomainError);
      expect(await counts(h)).toEqual(NOTHING);
    });
  });
});
