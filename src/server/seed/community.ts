// Demo data only. Historic competition engagement is rebuilt from the same
// real published release as the worker, not manufactured result milestones.
import { communityMember } from "../db/schema";
import {
  recordEngagement,
  communityMemberFor,
  type Subject,
} from "../modules/community";
import { COMMUNITY_MEMBER_PURPOSE } from "../modules/community/profile-fields";
import { recordPublishedEngagement } from "../modules/community/results";
import { subjectColumns } from "../modules/community/subjects";
import { publishedResults } from "../modules/results";
import { SEED_ACCOUNTS } from "./accounts";
import { SEED_GUARDIANS } from "./guardians";
import { SEED_RESULTS } from "./results";
import type { Seeder } from "./types";

export const seedCommunity: Seeder = async ({ db, clock, cipher }) => {
  const release = await publishedResults(db, SEED_RESULTS.competitionId);
  if (release)
    await recordPublishedEngagement(
      { db, clock, actor: { kind: "system", process: "worker" } },
      {
        competitionId: release.competitionId,
        releaseId: release.releaseId,
        publishedAt: release.publishedAt.toISOString(),
      }
    );
  const members: {
    subject: Subject;
    displayName: string;
    joinedBy: string;
    id: string;
  }[] = [
    {
      subject: { kind: "user", userId: SEED_ACCOUNTS.members[0].id },
      displayName: "Asha Rao",
      joinedBy: SEED_ACCOUNTS.members[0].id,
      id: "01938a00-0000-7000-8000-000000119001",
    },
    {
      subject: {
        kind: "profile",
        profileId: SEED_GUARDIANS.children.young.profileId,
      },
      displayName: "Isha D.",
      joinedBy: SEED_GUARDIANS.guardian.id,
      id: "01938a00-0000-7000-8000-000000119002",
    },
  ];
  await db.transaction(async (tx) => {
    for (const sample of members) {
      const now = clock.now();
      const existing = await communityMemberFor(tx, sample.subject);
      if (!existing) {
        await tx
          .insert(communityMember)
          .values({
            id: sample.id,
            ...subjectColumns(sample.subject),
            joinedByUserId: sample.joinedBy,
            displayNameCiphertext: cipher.encrypt(
              COMMUNITY_MEMBER_PURPOSE.displayName,
              sample.displayName
            ),
            aboutCiphertext: null,
            status: "active",
            joinedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
      }
      await recordEngagement(
        tx,
        { clock, actor: { kind: "system", process: "seed" } },
        {
          type: "milestone",
          subject: sample.subject,
          kind: "community_member",
          competitionId: null,
          occurredAt: existing?.joinedAt ?? now,
          sourceType: "community_member",
          sourceId: existing?.id ?? sample.id,
        }
      );
    }
  });
};
