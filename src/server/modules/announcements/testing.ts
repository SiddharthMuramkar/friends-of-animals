// Test helpers for the announcements module: competitions, staff holding
// chosen roles, and registrants enrolled through the public use cases.
// Tests only: nothing in the app imports this file.

import { eq } from "drizzle-orm";

import type { Grant } from "@/server/access/domain/roles";
import type { Actor } from "@/server/actor";
import { participantProfile, registration } from "@/server/db/schema";
import {
  adultForm,
  openToIndividuals,
  type OpenCompetition,
} from "@/server/modules/participants/testing";
import { setInstitutionFee } from "@/server/modules/payments/testing";
import type { Harness } from "@/test/harness";
import { makeCoordinator, seedInstitution } from "@/test/institutions";

import { isUnder18On } from "./domain/age";
import type { AnnouncementContentInput } from "./domain/content";

/** Content with every section filled except the closing message. */
export function sampleContent(
  overrides: Partial<AnnouncementContentInput> = {}
): AnnouncementContentInput {
  return {
    subject: "Phase 3: the drawing day",
    // 10:00 IST
    eventAt: new Date("2027-02-06T04:30:00.000Z"),
    confirmedTheme: "Street dogs of our city",
    permittedMaterials: "Pencils, crayons and watercolours on A3 paper",
    duration: "Two hours",
    submissionSteps:
      "Photograph your drawing in daylight.\nUpload it from your dashboard.",
    physicalArtworkRequirements: "Post the original drawing to the FOA office.",
    deadlines: "Uploads close on 13 February 2027 at 11:59 pm IST.",
    helpContacts: "Write to competitions@foa.example",
    message: null,
    ...overrides,
  };
}

/** A signed-in user holding `grants` (none: a plain member). */
export async function signedInWith(
  h: Harness,
  ...grants: Grant[]
): Promise<Actor> {
  const user = await h.seed.member();
  await h.seed.grant(user, ...grants);
  return h.signIn(user);
}

/** A competition with registration open and one age group for everyone. */
async function announcementCompetition(h: Harness, name = "Paws for Thought") {
  const competition = await openToIndividuals(h, {
    fee: 0n,
    name,
    ageGroups: [{ label: "Everyone", minAge: 5, maxAge: 99 }],
  });
  return { ...competition, name };
}

export async function announcementWorld(h: Harness) {
  const competition = await announcementCompetition(h);
  const other = await announcementCompetition(h, "Whiskers and Wings");

  const world = {
    competition,
    competitionId: competition.id,
    otherCompetition: other,
    otherCompetitionId: other.id,
    as: (actor: Actor) => h.as(actor),
    /** A competition manager: global, or for one competition. */
    manager: (scope: { competitionId: string } | "global" = "global") =>
      signedInWith(h, {
        role: "competition_manager",
        scope:
          scope === "global"
            ? { type: "global" }
            : { type: "competition", id: scope.competitionId },
      }),
    /** A draft on this world's competition; returns its id. */
    async draft(
      actor: Actor,
      overrides: Partial<AnnouncementContentInput> = {}
    ): Promise<string> {
      const created = await h.as(actor).createAnnouncement({
        competitionId: competition.id,
        content: sampleContent(overrides),
      });
      if (!created.ok) throw new Error(`No draft: ${created.error}`);
      return created.announcement.id;
    },
  };
  return world;
}

/** The date of birth of someone `years` old on 15 January 2027 (IST). */
export function bornYearsBefore2027(years: number): string {
  return `${2027 - years}-01-01`;
}

type SchoolStudent = {
  fullName: string;
  dateOfBirth: string;
  email?: string;
  phone?: string;
  guardian?: { name: string; email: string | null; phone: string };
  status: "confirmed" | "enrolled" | "withdrawn";
};

type Family = Awaited<ReturnType<Harness["seed"]["guardian"]>>;

async function registerIndividual(
  h: Harness,
  actor: Actor,
  form: ReturnType<typeof adultForm>,
  confirm: boolean
) {
  const participant = h.as(actor);
  const registered = await participant.registerAsIndividual(form);
  if (!registered.ok || registered.status !== "pending_payment") {
    throw new Error(
      `Could not register individual: ${JSON.stringify(registered)}`
    );
  }
  const { registrationId } = registered;
  if (confirm) {
    const paid = await participant.payForMyRegistration({ registrationId });
    if (!paid.ok || paid.kind !== "confirmed_free") {
      throw new Error(`Could not confirm individual: ${JSON.stringify(paid)}`);
    }
  }
  return registrationId;
}

export async function registerChild(
  h: Harness,
  competition: OpenCompetition,
  family: Family
) {
  const parent = await h.signIn(family.account);
  const {
    fullName: _name,
    dateOfBirth: _birth,
    ...form
  } = adultForm(competition);
  const registrationId = await registerIndividual(
    h,
    parent,
    { ...form, forChildId: family.childIds[0]! },
    true
  );
  return { ...family, registrationId };
}

export function registrants(h: Harness, competition: OpenCompetition) {
  return {
    /** An adult registered on their own, with an account. */
    async adult(
      details: { name: string; email: string; phone?: string },
      status: "confirmed" | "pending_payment" = "confirmed"
    ) {
      const account = await h.seed.member(details);
      const actor = await h.signIn(account);
      await registerIndividual(
        h,
        actor,
        adultForm(competition, {
          fullName: details.name,
          dateOfBirth: bornYearsBefore2027(30),
          ...(details.phone === undefined ? {} : { phone: details.phone }),
        }),
        status === "confirmed"
      );
      return account;
    },
    /** A confirmed registration made by a verified guardian. */
    async child(options: {
      guardian: { name: string; email: string };
      child: { fullName: string; age: number; loginUserId?: string | null };
    }) {
      const family = await h.seed.guardian({
        ...options.guardian,
        children: [options.child],
      });
      return registerChild(h, competition, family);
    },
    /** A school with students at different stages of enrolment. */
    async school(options: {
      name: string;
      coordinators: { name: string; email: string }[];
      students: SchoolStudent[];
    }) {
      const { institution } = await seedInstitution(h, { name: options.name });
      const coordinators = [];
      for (const details of options.coordinators) {
        const teacher = await h.seed.member(details);
        await makeCoordinator(h, teacher, institution.id);
        coordinators.push(teacher);
      }
      const coordinator = h.as(await h.signIn(coordinators[0]!));
      const registered = await coordinator.registerInstitutionForCompetition({
        institutionId: institution.id,
        competitionId: competition.id,
      });
      if (!registered.ok)
        throw new Error(`Could not register school: ${registered.error}`);
      const school = {
        institutionId: institution.id,
        reference: registered.reference,
      };
      const students = new Map<SchoolStudent, { registrationId: string }>();

      const enrol = async (student: SchoolStudent) => {
        // Separate registration instants keep roster order deterministic.
        h.clock.advance({ milliseconds: 1 });
        const minor = isUnder18On(student.dateOfBirth, h.clock.now());
        const guardian = student.guardian ?? {
          name: "Original guardian",
          phone: "+919000000505",
          email: null,
        };
        const enrolled = await coordinator.enrolStudent({
          ...school,
          student: {
            fullName: student.fullName,
            dateOfBirth: student.dateOfBirth,
            email: student.email,
            phone: student.phone ?? "+919000000606",
            guardianName: guardian.name,
            guardianRelationship: "parent",
            guardianPhone: guardian.phone,
            guardianEmail: guardian.email ?? undefined,
          },
        });
        if (!enrolled.ok)
          throw new Error(
            `Could not enrol student: ${JSON.stringify(enrolled)}`
          );
        const { registrationId } = enrolled;
        students.set(student, { registrationId });
        if (minor && !student.guardian) {
          // Simulate a historical enrolment whose contact details are gone.
          const [row] = await h.db
            .select({ profileId: registration.participantProfileId })
            .from(registration)
            .where(eq(registration.id, registrationId));
          await h.db
            .update(participantProfile)
            .set({
              guardianNameCiphertext: null,
              guardianRelationship: null,
              guardianPhoneCiphertext: null,
              guardianEmailCiphertext: null,
            })
            .where(eq(participantProfile.id, row!.profileId));
        }
        if (student.status === "withdrawn") {
          const withdrawn = await coordinator.withdrawStudent({
            ...school,
            registrationId,
          });
          if (!withdrawn.ok)
            throw new Error(`Could not withdraw student: ${withdrawn.error}`);
        }
      };

      const confirmed = options.students.filter(
        (student) => student.status === "confirmed"
      );
      for (const student of confirmed) await enrol(student);
      if (confirmed.length > 0) {
        await setInstitutionFee(h, { competition }, 0n);
        const paid = await coordinator.payInstitutionFees(school);
        if (
          !paid.ok ||
          paid.kind !== "confirmed_free" ||
          paid.confirmed !== confirmed.length
        ) {
          throw new Error(
            `Could not confirm students: ${JSON.stringify(paid)}`
          );
        }
      }
      for (const student of options.students) {
        if (student.status !== "confirmed") await enrol(student);
      }
      return {
        ...school,
        institutionRegistrationId: registered.registrationId,
        coordinators,
        students: options.students.map((student) => students.get(student)!),
      };
    },
  };
}

/** The subject line of the sample announcement, as the default template writes it. */
export const SAMPLE_SUBJECT = "Paws for Thought: Phase 3: the drawing day";

/**
 * The #84 brief's Seam 1 world on the world's competition: two confirmed
 * adults (Vikram has turned SMS off), a confirmed 15-year-old with their
 * own login and a guardian account, a confirmed school registration with
 * two coordinators and its students (an adult with their own contact, two
 * siblings whose guardian has no account, a withdrawn student and a child
 * nobody can reach), and an adult who hasn't paid.
 */
export async function fullAudience(
  h: Harness,
  world: Awaited<ReturnType<typeof announcementWorld>>
) {
  const add = registrants(h, world.competition);
  const asha = await add.adult({
    name: "Asha Rao",
    email: "asha@example.test",
    phone: "90000 00101",
  });
  const vikram = await add.adult({
    name: "Vikram Shah",
    email: "vikram@example.test",
    phone: "90000 00102",
  });
  const smsOff = await h
    .as(await h.signIn(vikram))
    .updateNotificationPreferences({ email: true, sms: false });
  if (!smsOff.ok) throw new Error("Could not turn Vikram's SMS off");
  const teen = await h.seed.member({
    name: "Rohan Desai",
    email: "rohan@example.test",
  });
  const desai = await add.child({
    guardian: { name: "Kavita Desai", email: "kavita@example.test" },
    child: { fullName: "Rohan Desai", age: 15, loginUserId: teen.id },
  });
  const school = await add.school({
    name: "Hill School",
    coordinators: [
      { name: "Meera Iyer", email: "meera@example.test" },
      { name: "Arun Pillai", email: "arun@example.test" },
    ],
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
          email: "kiran@example.test",
          phone: "+919000000303",
        },
        status: "confirmed",
      },
      {
        fullName: "Ishan Rao",
        dateOfBirth: bornYearsBefore2027(8),
        guardian: {
          name: "Kiran Rao",
          email: "Kiran@Example.test",
          phone: "+91 90000 00303",
        },
        status: "confirmed",
      },
      {
        fullName: "Dev Patel",
        dateOfBirth: bornYearsBefore2027(11),
        guardian: {
          name: "Nita Patel",
          email: "nita@example.test",
          phone: "+919000000404",
        },
        status: "withdrawn",
      },
      {
        fullName: "Tara Singh",
        dateOfBirth: bornYearsBefore2027(12),
        status: "confirmed",
      },
    ],
  });
  const pending = await add.adult(
    { name: "Pia Menon", email: "pia@example.test" },
    "pending_payment"
  );
  return { asha, vikram, teen, desai, school, pending };
}

/** Everyone the full audience's announcement goes to, by email. */
export const FULL_AUDIENCE_EMAILS = [
  "arun@example.test",
  "asha@example.test",
  "kavita@example.test",
  "kiran@example.test",
  "meera@example.test",
  "sana@example.test",
  "vikram@example.test",
];

/** The full audience's counts, as the send confirmation gives them. */
export const FULL_AUDIENCE_COUNTS = {
  recipients: 7,
  participants: 3,
  guardians: 2,
  coordinators: 2,
  unreachable: 1,
};
