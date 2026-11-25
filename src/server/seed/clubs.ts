// Synthetic preview fixtures. Never modify an existing club or recreate a
// membership somebody ended. The real #119 engagement seam writes history.
import { and, eq } from "drizzle-orm";
import {
  club,
  clubDecision,
  clubMembership,
  institution,
  user,
} from "../db/schema";
import { recordEngagement } from "../modules/community";
import { SEED_INSTITUTIONS } from "./institutions";
import type { Seeder } from "./types";
export const SEED_CLUB = {
  id: "01938a00-0000-7000-8000-000000121001",
  name: "Kindness club",
  membershipId: "01938a00-0000-7000-8000-000000121002",
  decisionId: "01938a00-0000-7000-8000-000000121003",
};
export const seedClubs: Seeder = async ({ db, clock }) => {
  const [school] = await db
    .select({ id: institution.id })
    .from(institution)
    .where(
      and(
        eq(institution.id, SEED_INSTITUTIONS.verified.id),
        eq(institution.status, "verified")
      )
    );
  const [teacher] = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.id, SEED_INSTITUTIONS.verified.admin.id),
        eq(user.email, SEED_INSTITUTIONS.verified.admin.email)
      )
    );
  if (!school || !teacher) return;
  await db.transaction(async (tx) => {
    const now = clock.now();
    const [created] = await tx
      .insert(club)
      .values({
        id: SEED_CLUB.id,
        name: SEED_CLUB.name,
        institutionId: school.id,
        applicantUserId: teacher.id,
        applicantKind: "teacher",
        applicantVerified: true,
        status: "approved",
        appliedAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) return;
    await tx
      .insert(clubDecision)
      .values({
        id: SEED_CLUB.decisionId,
        clubId: created.id,
        fromStatus: "applied",
        toStatus: "approved",
        decidedAt: now,
      });
    await tx
      .insert(clubMembership)
      .values({
        id: SEED_CLUB.membershipId,
        clubId: created.id,
        userId: teacher.id,
        role: "teacher",
        affiliationVerified: true,
        joinedAt: now,
      });
    await recordEngagement(
      tx,
      { actor: { kind: "system", process: "seed" }, clock },
      {
        type: "entry",
        subject: { kind: "user", userId: teacher.id },
        kind: "club.joined",
        occurredAt: now,
        sourceKey: `club_membership:${SEED_CLUB.membershipId}:joined`,
        refType: "club",
        refId: created.id,
      }
    );
  });
};
