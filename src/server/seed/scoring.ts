// A separate, closed-to-submissions digital round (#96), with realistic
// fabricated work. Does not move any existing participant's entries or
// alter the physical-artwork sample round. Desktop/mobile journeys use
// separate judges so they never overwrite each other's scores.
import { and, asc, eq } from "drizzle-orm";
import {
  competitionAgeGroup,
  criterionScore,
  entry,
  entryFile,
  entryVerification,
  fileAsset,
  judgingRound,
  judgingRoundRubric,
  rubric,
  rubricCriterion,
  roundAssignment,
  roundEntry,
  judgeOnboarding,
  consentEvent,
  participantProfile,
  registration,
  scoreSheet,
} from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { latestDocument } from "../modules/consent/repository";
import { storageKeyFor } from "../modules/files/domain/storage-key";
import { pinRubrics } from "../modules/judging/domain/rubric-pins";
import { roundNameKey } from "../modules/judging/domain/round-settings";
import { PROFILE_PURPOSE } from "../modules/registration/student-profile";
import { identityKeyInput } from "../modules/registration/domain/identity-key";
import { IDENTITY_HASH_PURPOSE } from "../modules/registration/domain/prepare-student";
import { essayBodyFromText, essayBodyText } from "../rich-text/essay";
import { countWords } from "../modules/entries/domain/essay-text";
import { ensureGrant } from "./access";
import { SEED_SCORING_COMPETITION } from "./competitions";
import { seedEntryDerivatives, seedVideoDerivatives } from "./entries";
import { seedFilesLocation } from "./files";
import type { SeedDeps } from "./types";
const id = (n: number) =>
  `01938a00-0000-7000-8000-000000096${String(n).padStart(3, "0")}`;
export const SEED_SCORING = {
  roundId: id(2),
  judges: [
    {
      id: id(3),
      name: "Sample Scoring Judge",
      email: "scoring-judge-desktop@example.test",
    },
    {
      id: id(4),
      name: "Sample Scoring Judge Two",
      email: "scoring-judge-mobile@example.test",
    },
  ],
  entryCodes: ["JURY27-E-5EED01", "JURY27-E-5EED02", "JURY27-E-5EED03"],
} as const;
const examples = [
  {
    kind: "image",
    discipline: "drawing",
    name: "Nisha Sample",
    title: "Cool shade",
    description: "A drawing of street dogs resting in shade.",
  },
  {
    kind: "video",
    discipline: "videography",
    name: "Kabir Sample",
    title: "A water bowl",
    description: "A short clip showing kindness to birds.",
  },
  {
    kind: "text",
    discipline: "essay",
    name: "Anita Sample",
    title: "Sharing our street",
    description: "A short essay about caring for neighbours.",
  },
] as const;
const SAMPLE_ESSAY =
  "A bowl outside our door fills with birds before the day grows hot. A neighbour keeps it clean and adds fresh water every morning.\n\nWhen we remember that animals need the same shade and water that we do, we can make our street kinder.";
export async function seedScoring(deps: SeedDeps) {
  const { db, clock, storage, cipher, blindIndex } = deps;
  const now = clock.now();
  const competitionId = SEED_SCORING_COMPETITION.id;
  const roundId = SEED_SCORING.roundId;
  const [group] = await db
    .select({ id: competitionAgeGroup.id })
    .from(competitionAgeGroup)
    .where(
      and(
        eq(competitionAgeGroup.competitionId, competitionId),
        eq(competitionAgeGroup.label, "Adults")
      )
    );
  if (!group) return;
  const pinned = pinRubrics(
    ["drawing", "videography", "essay"],
    await db
      .select()
      .from(rubric)
      .where(eq(rubric.competitionId, competitionId))
  );
  if (!pinned.ok) return;
  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(judgingRound)
      .values({
        id: roundId,
        competitionId,
        name: "Sample digital judging",
        nameKey: roundNameKey("Sample digital judging"),
        status: "open",
        judgesPhysical: false,
        level: "national",
        awardScheme: "ranked_123",
        createdAt: now,
        updatedAt: now,
        openedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: judgingRound.id });
    if (inserted)
      await tx.insert(judgingRoundRubric).values(
        pinned.pins.map((p) => ({
          roundId,
          discipline: p.discipline,
          rubricId: p.rubricId,
        }))
      );
  });
  const [round] = await db
    .select({ status: judgingRound.status })
    .from(judgingRound)
    .where(eq(judgingRound.id, roundId));
  if (round?.status !== "open") return;
  const ids: {
    id: string;
    discipline: (typeof examples)[number]["discipline"];
    index: number;
  }[] = [];
  for (const [index, example] of examples.entries()) {
    const n = index + 1;
    const account = await ensureVerifiedAccount(deps, {
      id: id(10 + n),
      name: example.name,
      email: `scoring-participant-${n}@example.test`,
    });
    const profileId = id(20 + n),
      registrationId = id(30 + n),
      entryId = id(40 + n),
      assetId = id(50 + n),
      liveFileId = id(60 + n);
    const { bucket, keyPrefix: prefix } = seedFilesLocation();
    const ready = await db.transaction(async (tx) => {
      await tx
        .insert(participantProfile)
        .values({
          id: profileId,
          ownerKind: "self",
          ownerUserId: account.id,
          participantCode: `FOA-P-275EED0${n}`,
          fullName: example.name,
          dobCiphertext: cipher.encrypt(PROFILE_PURPOSE.dob, "1995-04-12"),
          identityHash: blindIndex.of(
            IDENTITY_HASH_PURPOSE,
            identityKeyInput(example.name, { year: 1995, month: 4, day: 12 })
          ),
          city: "Pune",
          country: "IN",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
      const [profile] = await tx
        .select({ id: participantProfile.id })
        .from(participantProfile)
        .where(
          and(
            eq(participantProfile.id, profileId),
            eq(participantProfile.ownerUserId, account.id)
          )
        );
      if (!profile) return false;
      await tx
        .insert(registration)
        .values({
          id: registrationId,
          participantProfileId: profileId,
          competitionId,
          route: "individual",
          ageGroupId: group.id,
          status: "confirmed",
          registrationNumber: `JURY27-R-5EED0${n}`,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
      const [reg] = await tx
        .select({ id: registration.id })
        .from(registration)
        .where(
          and(
            eq(registration.id, registrationId),
            eq(registration.status, "confirmed")
          )
        );
      if (!reg) return false;
      const [created] = await tx
        .insert(entry)
        .values({
          id: entryId,
          code: SEED_SCORING.entryCodes[index]!,
          competitionId,
          registrationId,
          participantProfileId: profileId,
          discipline: example.discipline,
          title: example.title,
          description: example.description,
          status: "foa_verified",
          submittedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: entry.id });
      if (created) {
        if (example.kind !== "text") {
          const purpose =
            example.kind === "video" ? "entry_video" : "entry_image";
          await tx.insert(fileAsset).values({
            id: assetId,
            ownerUserId: account.id,
            purpose,
            contentType: example.kind === "video" ? "video/mp4" : "image/jpeg",
            sizeBytes: 100_000,
            bucket,
            storageKey: storageKeyFor({ prefix, purpose, fileId: assetId }),
            status: "clean",
            uploadedAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }
        const essayBody = essayBodyFromText(SAMPLE_ESSAY);
        await tx.insert(entryFile).values({
          id: liveFileId,
          entryId,
          kind: example.kind,
          attemptNumber: 1,
          status: "live",
          uploadCompletedAt: now,
          becameLiveAt: now,
          createdAt: now,
          updatedAt: now,
          ...(example.kind === "text"
            ? { essayBody, wordCount: countWords(essayBodyText(essayBody)) }
            : { fileAssetId: assetId }),
        });
        await tx.insert(entryVerification).values({
          id: id(70 + n),
          entryId,
          decision: "verified",
          decidedAt: now,
        });
      }
      const [live] = await tx
        .select({ id: entryFile.id })
        .from(entryFile)
        .where(
          and(
            eq(entryFile.id, liveFileId),
            eq(entryFile.entryId, entryId),
            eq(entryFile.status, "live")
          )
        );
      if (!live) return false;
      if (storage && example.kind === "image")
        await seedEntryDerivatives(tx, storage, {
          bucket,
          prefix,
          fileId: assetId,
          now,
        });
      if (storage && example.kind === "video")
        await seedVideoDerivatives(tx, storage, {
          bucket,
          prefix,
          fileId: assetId,
          now,
        });
      const [verified] = await tx
        .select({ id: entry.id })
        .from(entry)
        .where(and(eq(entry.id, entryId), eq(entry.status, "foa_verified")));
      if (!verified) return false;
      await tx
        .insert(roundEntry)
        .values({ roundId, entryId, admittedAt: now })
        .onConflictDoNothing();
      return true;
    });
    if (ready) ids.push({ id: entryId, discipline: example.discipline, index });
  }
  const conduct = await latestDocument(db, "judge_conduct");
  const confidentiality = await latestDocument(db, "judge_confidentiality");
  if (!conduct || !confidentiality) return;
  for (const [judgeIndex, seed] of SEED_SCORING.judges.entries()) {
    const judge = await ensureVerifiedAccount(deps, seed);
    await ensureGrant(deps, judge.id, {
      role: "judge",
      scope: { type: "round", id: roundId },
    });
    const conductId = id(80 + judgeIndex * 2),
      confidentialityId = id(81 + judgeIndex * 2);
    await db.transaction(async (tx) => {
      await tx
        .insert(consentEvent)
        .values([
          {
            id: conductId,
            subjectType: "user",
            subjectId: judge.id,
            giverUserId: judge.id,
            purpose: "judge_conduct",
            documentId: conduct.id,
            action: "given",
            method: "web_form",
            occurredAt: now,
          },
          {
            id: confidentialityId,
            subjectType: "user",
            subjectId: judge.id,
            giverUserId: judge.id,
            purpose: "judge_confidentiality",
            documentId: confidentiality.id,
            action: "given",
            method: "web_form",
            occurredAt: now,
          },
        ])
        .onConflictDoNothing();
      await tx
        .insert(judgeOnboarding)
        .values({
          roundId,
          judgeUserId: judge.id,
          conductConsentEventId: conductId,
          confidentialityConsentEventId: confidentialityId,
          conflictsDeclaredAt: now,
          conflictsNone: true,
          updatedAt: now,
        })
        .onConflictDoNothing();
      for (const example of ids) {
        const [assignment] = await tx
          .insert(roundAssignment)
          .values({
            roundId,
            entryId: example.id,
            judgeUserId: judge.id,
            assignedAt: now,
          })
          .onConflictDoNothing()
          .returning({ entryId: roundAssignment.entryId });
        if (!assignment || example.index === 0) continue;
        const [pin] = await tx
          .select({ rubricId: judgingRoundRubric.rubricId })
          .from(judgingRoundRubric)
          .where(
            and(
              eq(judgingRoundRubric.roundId, roundId),
              eq(judgingRoundRubric.discipline, example.discipline)
            )
          );
        if (!pin) continue;
        const criteria = await tx
          .select()
          .from(rubricCriterion)
          .where(eq(rubricCriterion.rubricId, pin.rubricId))
          .orderBy(asc(rubricCriterion.position));
        const sheetId = id(90 + judgeIndex * 10 + example.index);
        const complete = example.index === 2;
        const [sheet] = await tx
          .insert(scoreSheet)
          .values({
            id: sheetId,
            roundId,
            entryId: example.id,
            judgeUserId: judge.id,
            version: 1,
            comment: complete
              ? "Clear and thoughtful essay."
              : "Review the ending in the next sitting.",
            commentVersion: 1,
            complete,
            completedAt: complete ? now : null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: scoreSheet.id });
        if (sheet)
          await tx.insert(criterionScore).values(
            (complete ? criteria : criteria.slice(0, 1)).map((c) => ({
              scoreSheetId: sheet.id,
              criterionId: c.id,
              value: Math.min(c.maxScore, Math.max(c.minScore, 7)),
              changedAtVersion: 1,
            }))
          );
      }
    });
  }
}
