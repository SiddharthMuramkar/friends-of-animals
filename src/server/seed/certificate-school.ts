// The existing synthetic AUCT27 release gains a school-route example whose
// two pupils took part in the school's decided shortlist-only round. They
// did not advance to FOA, so their participation certificates do not change
// the final result, original artwork, auction awards or public credits.
import { and, eq } from "drizzle-orm";
import {
  competition,
  competitionAgeGroup,
  institution,
  institutionRegistration,
  participantProfile,
  registration,
  schoolRound,
} from "../db/schema";
import { SEED_AUCTION_COMPETITION } from "./competitions";
import { SEED_INSTITUTIONS } from "./institutions";
import { SEED_STUDENTS } from "./registration";
import type { Seeder } from "./types";

const id = (n: number) =>
  `01938a00-0000-7000-8000-000000101${String(n).padStart(3, "0")}`;
export const SEED_CERTIFICATE_SCHOOL = {
  institutionRegistrationId: id(1),
  institutionId: SEED_INSTITUTIONS.verified.id,
  competitionId: SEED_AUCTION_COMPETITION.id,
  reference: "AUCT27-I-5EED1",
  roundId: id(2),
} as const;

export const seedCertificateSchool: Seeder = async ({ db, clock }) => {
  const s = SEED_CERTIFICATE_SCHOOL;
  const now = clock.now();
  const days = (n: number) => new Date(now.getTime() - n * 86400000);
  await db.transaction(async (tx) => {
    const [comp] = await tx
      .select()
      .from(competition)
      .where(
        and(
          eq(competition.id, s.competitionId),
          eq(competition.code, SEED_AUCTION_COMPETITION.code),
          eq(competition.slug, SEED_AUCTION_COMPETITION.slug)
        )
      );
    const [school] = await tx
      .select()
      .from(institution)
      .where(eq(institution.id, s.institutionId));
    if (
      !comp ||
      !school ||
      school.status !== "verified" ||
      school.name !== SEED_INSTITUTIONS.verified.name
    )
      return;
    // Update only the original exact synthetic competition, including an
    // already-seeded preview that still has its old individual route.
    if (
      comp.participation === "individuals" &&
      comp.digitalScope === "all_participants"
    ) {
      await tx
        .update(competition)
        .set({ participation: "both", digitalScope: "shortlist_only" })
        .where(eq(competition.id, comp.id));
    } else if (
      comp.participation !== "both" ||
      comp.digitalScope !== "shortlist_only"
    )
      return;
    const [group] = await tx
      .select({ id: competitionAgeGroup.id })
      .from(competitionAgeGroup)
      .where(
        and(
          eq(competitionAgeGroup.competitionId, comp.id),
          eq(competitionAgeGroup.label, "6–12")
        )
      );
    if (!group) return;
    // Both pupils have exact deterministic fixture identities. Never
    // attach another person's account or profile to the example.
    const profiles = [];
    for (const [index, student] of SEED_STUDENTS.slice(0, 2).entries()) {
      const [profile] = await tx
        .select({ id: participantProfile.id })
        .from(participantProfile)
        .where(
          and(
            eq(participantProfile.id, student.profileId),
            eq(participantProfile.ownerKind, "institution"),
            eq(participantProfile.managingInstitutionId, s.institutionId),
            eq(participantProfile.fullName, student.fullName)
          )
        );
      if (profile) profiles.push({ index, profileId: profile.id });
    }
    if (!profiles.length) return;
    await tx
      .insert(institutionRegistration)
      .values({
        id: s.institutionRegistrationId,
        institutionId: s.institutionId,
        competitionId: comp.id,
        reference: s.reference,
        createdAt: days(150),
        updatedAt: days(150),
      })
      .onConflictDoNothing();
    const [own] = await tx
      .select()
      .from(institutionRegistration)
      .where(eq(institutionRegistration.id, s.institutionRegistrationId));
    if (
      !own ||
      own.institutionId !== s.institutionId ||
      own.competitionId !== comp.id ||
      own.reference !== s.reference ||
      own.status !== "active"
    )
      return;
    for (const { index, profileId } of profiles) {
      await tx
        .insert(registration)
        .values({
          id: id(10 + index),
          participantProfileId: profileId,
          competitionId: comp.id,
          route: "institution",
          institutionRegistrationId: own.id,
          ageGroupId: group.id,
          status: "confirmed",
          registrationNumber: `AUCT27-R-SCH00${index + 1}`,
          createdAt: days(140),
          updatedAt: days(140),
        })
        .onConflictDoNothing();
    }
    await tx
      .insert(schoolRound)
      .values({
        id: s.roundId,
        competitionId: comp.id,
        institutionRegistrationId: own.id,
        status: "closed_on_behalf",
        closeReason:
          "Completed demonstration school round with no shortlisted entries",
        openedAt: days(60),
        closedAt: days(29),
        createdAt: days(60),
        updatedAt: days(29),
      })
      .onConflictDoNothing();
  });
};
