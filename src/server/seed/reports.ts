// Dedicated synthetic verification and results-approval work. The existing
// judging, artwork and published-results examples continue independently.
import { and, eq } from "drizzle-orm";
import {
  competitionAgeGroup,
  entry,
  entryFile,
  entryTransition,
  judgingRound,
  judgingRoundRubric,
  participantProfile,
  registration,
  resultAward,
  resultRelease,
  roundEntry,
  roundResult,
  rubric,
} from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { identityKeyInput } from "../modules/registration/domain/identity-key";
import { parseIsoDate } from "../modules/registration/domain/calendar-date";
import { IDENTITY_HASH_PURPOSE } from "../modules/registration/domain/prepare-student";
import { PROFILE_PURPOSE } from "../modules/registration/student-profile";
import { essayBodyFromText, essayBodyText } from "../rich-text/essay";
import { snapshotHash } from "../modules/results/releases";
import { TIE_BREAK_RULE } from "../modules/judging/domain/ranking";
import {
  SEED_COMPETITION_MANAGERS,
  SEED_REPORT_COMPETITIONS,
} from "./competitions";
import type { Seeder } from "./types";
import type { ResultAward } from "../db/schema";

const id = (n: number) =>
  `01938a00-0000-7000-8000-000000117${String(n).padStart(3, "0")}`;
export const SEED_REPORT_PARTICIPANT = {
  id: id(4),
  name: "Preview Reports Participant",
  email: "reports-participant@example.test",
};
export const SEED_WAITING_VERIFICATION = {
  id: id(21),
  code: "CHECK27-E-5EED01",
};
export const SEED_WAITING_RELEASE = {
  id: id(40),
  competitionId: SEED_REPORT_COMPETITIONS[0].id,
};

export const seedReports: Seeder = async (deps) => {
  const { db, clock } = deps;
  const now = clock.now(),
    day = (n: number) => new Date(now.getTime() + n * 86400000);
  const account = await ensureVerifiedAccount(deps, SEED_REPORT_PARTICIPANT);
  const manager = await ensureVerifiedAccount(
    deps,
    SEED_COMPETITION_MANAGERS[0]
  );
  const profileId = id(5);
  const dob = "1990-06-01";
  await db
    .insert(participantProfile)
    .values({
      id: profileId,
      ownerKind: "self",
      ownerUserId: account.id,
      participantCode: "FOA-P-265EED17",
      fullName: SEED_REPORT_PARTICIPANT.name,
      dobCiphertext: deps.cipher.encrypt(PROFILE_PURPOSE.dob, dob),
      identityHash: deps.blindIndex.of(
        IDENTITY_HASH_PURPOSE,
        identityKeyInput(SEED_REPORT_PARTICIPANT.name, parseIsoDate(dob)!)
      ),
      createdAt: day(-140),
      updatedAt: day(-140),
      createdBy: account.id,
    })
    .onConflictDoNothing();
  const [profile] = await db
    .select({ id: participantProfile.id })
    .from(participantProfile)
    .where(
      and(
        eq(participantProfile.id, profileId),
        eq(participantProfile.ownerUserId, account.id)
      )
    );
  if (!profile) return;
  for (const [index, comp] of SEED_REPORT_COMPETITIONS.entries()) {
    const [group] = await db
      .select()
      .from(competitionAgeGroup)
      .where(eq(competitionAgeGroup.competitionId, comp.id));
    if (!group) continue;
    const regId = id(10 + index),
      entryId = id(20 + index),
      fileId = id(30 + index);
    const entryCode = `${comp.code}-E-5EED01`;
    const status = index === 0 ? "foa_verified" : "submitted_to_foa";
    await db.transaction(async (tx) => {
      const [reg] = await tx
        .insert(registration)
        .values({
          id: regId,
          participantProfileId: profileId,
          competitionId: comp.id,
          route: "individual",
          ageGroupId: group.id,
          status: "confirmed",
          registrationNumber: `${comp.code}-R-5EED01`,
          createdAt: day(-135),
          updatedAt: day(-120),
        })
        .onConflictDoNothing()
        .returning({ id: registration.id });
      // A seeded participant can have acted on an earlier preview. Never
      // replace that registration, entry, or the status they reached.
      if (!reg) return;
      await tx.insert(entry).values({
        id: entryId,
        code: entryCode,
        competitionId: comp.id,
        registrationId: regId,
        participantProfileId: profileId,
        discipline: "essay",
        title: "A little kindness",
        description:
          "A sample typed essay about helping the neighbourhood animals.",
        status,
        submittedAt: day(-60),
        createdAt: day(-60),
        updatedAt: day(-44),
      });
      const body = essayBodyFromText(
        "We leave a bowl of fresh water in the shade for the animals on our street. Every day we wash the bowl and fill it again. Small acts of care make an important difference."
      );
      await tx.insert(entryFile).values({
        id: fileId,
        entryId,
        attemptNumber: 1,
        kind: "text",
        essayBody: body,
        wordCount: essayBodyText(body).split(/\s+/).filter(Boolean).length,
        status: "live",
        uploadCompletedAt: day(-60),
        becameLiveAt: day(-60),
        createdAt: day(-60),
        updatedAt: day(-60),
      });
      await tx
        .insert(entryTransition)
        .values([
          {
            id: id(60 + index * 3),
            entryId,
            sequence: 1,
            fromStatus: null,
            toStatus: "submitted",
            trigger: "essay_typed",
            entryFileId: fileId,
            actorKind: "user",
            actorUserId: account.id,
            at: day(-60),
          },
          {
            id: id(61 + index * 3),
            entryId,
            sequence: 2,
            fromStatus: "submitted",
            toStatus: "submitted_to_foa",
            trigger: "forwarded_to_foa",
            actorKind: "system",
            at: day(-44),
          },
          ...(index === 0
            ? [
                {
                  id: id(62),
                  entryId,
                  sequence: 3,
                  fromStatus: "submitted_to_foa",
                  toStatus: "foa_verified",
                  trigger: "foa_verified",
                  actorKind: "system",
                  at: day(-43),
                } as const,
              ]
            : []),
        ]);
      if (index !== 0) return;
      const [pin] = await tx
        .select({ id: rubric.id })
        .from(rubric)
        .where(
          and(
            eq(rubric.competitionId, comp.id),
            eq(rubric.discipline, "essay"),
            eq(rubric.status, "published")
          )
        );
      if (!pin) throw Error("The seed report final has no published rubric");
      const roundId = id(41),
        releaseId = SEED_WAITING_RELEASE.id;
      await tx.insert(judgingRound).values({
        id: roundId,
        competitionId: comp.id,
        name: "Completed essay final",
        nameKey: "completed essay final",
        status: "open",
        judgesPhysical: false,
        createdAt: day(-40),
        updatedAt: day(-40),
        openedAt: day(-39),
        createdByUserId: manager.id,
        openedByUserId: manager.id,
      });
      await tx
        .insert(judgingRoundRubric)
        .values({ roundId, discipline: "essay", rubricId: pin.id });
      await tx
        .insert(roundEntry)
        .values({ roundId, entryId, admittedAt: day(-38) });
      await tx.insert(roundResult).values({
        roundId,
        entryId,
        code: entryCode,
        discipline: "essay",
        categoryId: group.id,
        rank: 1,
        scoreNumerator: "90",
        scoreDenominator: "1",
        sheetsCounted: 2,
        outcome: "winner",
        awardPosition: 1,
        suitableForAuction: false,
      });
      await tx
        .update(judgingRound)
        .set({
          status: "locked",
          lockedAt: day(-10),
          lockedByUserId: manager.id,
          tieBreakRule: TIE_BREAK_RULE,
        })
        .where(eq(judgingRound.id, roundId));
      const release = {
        id: releaseId,
        competitionId: comp.id,
        sourceRoundId: roundId,
        preparedByUserId: manager.id,
        preparedAt: day(-1),
        publishAt: day(21),
        deliveryNote:
          "FOA will contact the participants to arrange their prizes.",
      };
      const award: ResultAward = {
        releaseId,
        entryId,
        discipline: "essay",
        categoryId: group.id,
        categoryLabel: group.label,
        outcome: "winner",
        awardPosition: 1,
        awardBand: "first",
        prize: null,
        suitableForAuction: false,
      };
      await tx
        .insert(resultRelease)
        .values({ ...release, contentHash: snapshotHash(release, [award]) });
      await tx.insert(resultAward).values(award);
    });
  }
};
