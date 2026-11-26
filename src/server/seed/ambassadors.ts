// The preview shows one established finalist able to apply (seedCommunity)
// and one pending application from an adult with genuinely approved service
// (seedVolunteerWork). Never change a membership or re-create a decision.
import { and, eq } from "drizzle-orm";
import {
  ambassadorApplication,
  communityMember,
  engagementMilestone,
  user,
  volunteerApplication,
} from "../db/schema";
import { recordEngagement, communityMemberFor } from "../modules/community";
import { COMMUNITY_MEMBER_PURPOSE } from "../modules/community/profile-fields";
import { ambassadorEligibility } from "../modules/community/ambassadors/domain/eligibility";
import { ageAt } from "../modules/participants/domain/age";
import { parseIsoDate } from "../modules/registration/domain/calendar-date";
import { readSetting } from "../modules/settings/read";
import { DATE_OF_BIRTH_PURPOSE } from "../modules/volunteers/application-record";
import { SEED_VOLUNTEERS } from "./volunteers";
import type { Seeder } from "./types";

export const seedAmbassadors: Seeder = async ({ db, clock, cipher }) => {
  const [volunteer] = await db
    .select({ id: user.id, dob: volunteerApplication.dateOfBirthCiphertext })
    .from(user)
    .innerJoin(
      volunteerApplication,
      eq(volunteerApplication.applicantUserId, user.id)
    )
    .where(
      and(
        eq(user.email, SEED_VOLUNTEERS.approved.email),
        eq(user.name, SEED_VOLUNTEERS.approved.name),
        eq(volunteerApplication.id, SEED_VOLUNTEERS.approved.applicationId),
        eq(volunteerApplication.status, "approved")
      )
    );
  if (!volunteer) return;
  const subject = { kind: "user", userId: volunteer.id } as const;
  await db.transaction(async (tx) => {
    if (await communityMemberFor(tx, subject)) return;
    const milestones = await tx
      .select({ kind: engagementMilestone.kind })
      .from(engagementMilestone)
      .where(eq(engagementMilestone.subjectUserId, volunteer.id));
    if (!milestones.some(({ kind }) => kind === "volunteer")) return;
    const now = clock.now();
    const joinedAt = new Date(now.getTime() - 91 * 86_400_000);
    const id = "01938a00-0000-7000-8000-000000122001";
    const [member] = await tx
      .insert(communityMember)
      .values({
        id,
        subjectUserId: volunteer.id,
        joinedByUserId: volunteer.id,
        displayNameCiphertext: cipher.encrypt(
          COMMUNITY_MEMBER_PURPOSE.displayName,
          SEED_VOLUNTEERS.approved.name
        ),
        status: "active",
        joinedAt,
        createdAt: joinedAt,
        updatedAt: joinedAt,
      })
      .onConflictDoNothing()
      .returning();
    if (!member) return;
    await recordEngagement(
      tx,
      { clock, actor: { kind: "system", process: "seed" } },
      {
        type: "milestone",
        subject,
        kind: "community_member",
        occurredAt: joinedAt,
        competitionId: null,
        sourceType: "community_member",
        sourceId: id,
      }
    );
    const dob = parseIsoDate(
      cipher.decrypt(DATE_OF_BIRTH_PURPOSE, volunteer.dob)
    );
    const eligible = ambassadorEligibility(
      {
        membership: member,
        ageYears: dob ? ageAt(dob, now) : null,
        milestones: milestones.map(({ kind }) => kind),
        hasOpenApplication: false,
      },
      {
        membershipDays: await readSetting(tx, "ambassadors.minMembershipDays"),
        ageYears: await readSetting(tx, "ambassadors.minAgeYears"),
        qualifyingMilestones: await readSetting(
          tx,
          "ambassadors.qualifyingMilestones"
        ),
      },
      now,
      "apply"
    );
    if (!eligible.eligible) return;
    await tx
      .insert(ambassadorApplication)
      .values({
        id: "01938a00-0000-7000-8000-000000122002",
        applicantUserId: volunteer.id,
        status: "submitted",
        submittedAt: now,
      })
      .onConflictDoNothing();
  });
};
