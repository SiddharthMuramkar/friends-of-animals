import { describe, expect, it } from "vitest";

import {
  institutionRegistration,
  participantProfile,
  registration,
} from "@/server/db/schema";
import { createHarness } from "@/test/harness";
import { seedInstitution } from "@/test/institutions";

import { SEED_CANCELLED } from "./competition-cancelled";
import { SEED_COORDINATORS } from "./coordinators";
import { SEED_SCHOOL_SUBMISSIONS } from "./institution-submissions";
import { SEED_PAYMENTS } from "./payments";
import { SEED_OBJECTIVES } from "./objectives";
import { SEED_CERTIFICATE_SCHOOL } from "./certificate-school";
import { SEED_REGISTRATIONS, SEED_STUDENTS } from "./registration";
import { SEED_SCOPES } from "./scopes";

describe("the registration seed", () => {
  it("registers the seeded verified institution for the seeded open competition, once however often it runs", async () => {
    const h = await createHarness();
    await h.seed.preview();
    await h.seed.preview();

    expect(
      await h.db
        .select()
        .from(institutionRegistration)
        .orderBy(institutionRegistration.id)
    ).toEqual([
      expect.objectContaining({
        id: SEED_REGISTRATIONS.institution.id,
        institutionId: SEED_SCOPES.institution.id,
        competitionId: "01938a00-0000-7000-8000-000000002101",
        reference: "NEIGH27-I-5EED1",
        status: "active",
      }),
      // The payments seed's paid registration for the closed Kinder Skies.
      expect.objectContaining({
        id: SEED_PAYMENTS.paid.institutionRegistrationId,
        institutionId: SEED_SCOPES.institution.id,
        competitionId: "01938a00-0000-7000-8000-000000002103",
        reference: "SKIES26-I-5EED2",
        status: "active",
      }),
      // The school-route submissions seed's, for Trees for Birds (#87).
      expect.objectContaining({
        id: SEED_SCHOOL_SUBMISSIONS.institutionRegistration.id,
        institutionId: SEED_SCOPES.institution.id,
        competitionId:
          SEED_SCHOOL_SUBMISSIONS.institutionRegistration.competitionId,
        reference: "TREES27-I-5EED3",
        status: "active",
      }),
      // The cancelled competition's seed: its registration for Wings at
      // Dusk (#80).
      expect.objectContaining({
        id: SEED_CANCELLED.institutionRegistrationId,
        institutionId: SEED_SCOPES.institution.id,
        competitionId: SEED_CANCELLED.competitionId,
        reference: "WINGS26-I-5EED3",
        status: "active",
      }),
      expect.objectContaining({
        id: "01938a00-0000-7000-8000-000000093000",
        institutionId: SEED_SCOPES.institution.id,
        competitionId: "01938a00-0000-7000-8000-000000009301",
        reference: "ORIG27-I-5EED1",
        status: "active",
      }),
      expect.objectContaining({
        id: SEED_CERTIFICATE_SCHOOL.institutionRegistrationId,
        institutionId: SEED_CERTIFICATE_SCHOOL.institutionId,
        competitionId: SEED_CERTIFICATE_SCHOOL.competitionId,
        reference: SEED_CERTIFICATE_SCHOOL.reference,
        status: "active",
      }),
      expect.objectContaining({
        id: "01938a00-0000-7000-8000-000000135002",
        institutionId: SEED_CERTIFICATE_SCHOOL.institutionId,
        competitionId: SEED_OBJECTIVES.competitionId,
        reference: "KIND27-I-5EED1",
        status: "active",
      }),
    ]);
  });

  it("shows the seeded coordinator the registration on the competitions list", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const coordinator = await h.signIn(SEED_COORDINATORS.coordinator);

    const list = await h.as(coordinator).listCompetitionsForInstitution({
      institutionId: SEED_SCOPES.institution.id,
    });

    expect(list.ok && list.competitions[0]).toMatchObject({
      code: "NEIGH27",
      window: "open",
      registration: { reference: "NEIGH27-I-5EED1" },
    });
  });

  it("gives tests a builder that registers an institution without a coordinator", async () => {
    const h = await createHarness();
    const { institution: x } = await seedInstitution(h);
    const competition = await h.seed.competition({
      status: "registration_open",
      participation: "institutions",
      code: "BUILD27",
    });

    const built = await h.seed.institutionRegistration({
      institutionId: x.id,
      competitionId: competition.id,
    });

    expect(built.reference).toMatch(/^BUILD27-I-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(await h.db.select().from(institutionRegistration)).toEqual([
      expect.objectContaining({
        id: built.id,
        institutionId: x.id,
        competitionId: competition.id,
        reference: built.reference,
        registeredBy: null,
      }),
    ]);
  });

  it("enrols six students across the competition's age groups and one withdrawn, under the seeded registration", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const coordinator = await h.signIn(SEED_COORDINATORS.coordinator);

    const dashboard = await h.as(coordinator).listEnrolledStudents({
      institutionId: SEED_SCOPES.institution.id,
      reference: "NEIGH27-I-5EED1",
    });

    expect(dashboard.ok && dashboard.counts).toEqual({
      enrolled: 6,
      confirmed: 0,
      withdrawn: 1,
      // The individual route's status (#78): never a school's.
      pending_payment: 0,
      // A fee given back (#80): nothing is refunded in the seed's NEIGH27.
      refunded: 0,
      pending_guardian: 0,
      // Its competition called off (#80): NEIGH27 isn't.
      cancelled: 0,
    });
    const students = dashboard.ok ? dashboard.students : [];
    const groupsOfEnrolled = new Set(
      students
        .filter((student) => student.status === "enrolled")
        .map((student) => student.ageGroupLabel)
    );
    expect(groupsOfEnrolled.size).toBeGreaterThanOrEqual(2);
  });

  it("enrols them once however often it runs, with fictional contacts stored encrypted", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const once = await h.db.select().from(registration);
    await h.seed.preview();

    expect(await h.db.select().from(registration)).toEqual(once);
    // This seed's students; adults' own profiles are the participants
    // seed's (#78), and TREES27's the school-route submissions seed's (#87).
    const profiles = (await h.db.select().from(participantProfile)).filter(
      (profile) =>
        profile.ownerKind === "institution" &&
        SEED_STUDENTS.some((student) => student.profileId === profile.id)
    );
    expect(profiles).toHaveLength(7);
    for (const profile of profiles) {
      expect(profile.dobCiphertext).toMatch(/^v\d+:/);
      const phone = h.deps.cipher.decrypt(
        "participant_profile.guardian_phone",
        profile.guardianPhoneCiphertext!
      );
      expect(phone).toMatch(/^\+9190000051\d\d$/);
      const email = h.deps.cipher.decrypt(
        "participant_profile.guardian_email",
        profile.guardianEmailCiphertext!
      );
      expect(email).toMatch(/@example\.test$/);
    }
  });

  it("recognises a seeded student, so a coordinator can't enrol them again", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const coordinator = await h.signIn(SEED_COORDINATORS.coordinator);
    const [seeded] = SEED_STUDENTS;

    const result = await h.as(coordinator).enrolStudent({
      institutionId: SEED_SCOPES.institution.id,
      reference: "NEIGH27-I-5EED1",
      student: {
        fullName: seeded!.fullName,
        dateOfBirth: seeded!.dateOfBirth,
        guardianName: "Someone Else",
        guardianRelationship: "parent",
        guardianPhone: "90000 05199",
      },
    });

    expect(result).toEqual({ ok: false, error: "already_enrolled" });
  });
});
