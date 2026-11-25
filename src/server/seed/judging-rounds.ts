// Preview-only sample rounds and judges (#95). Terms are sample documents,
// never published to staging or production by this seed.
import { and, eq, inArray } from "drizzle-orm";
import {
  competition,
  entry,
  roundEntry,
  roundAssignment,
  consentEvent,
  judgeInvitation,
  judgeOnboarding,
  judgingRound,
  judgingRoundRubric,
  rubric,
} from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { latestDocument } from "../modules/consent/repository";
import { pinRubrics } from "../modules/judging/domain/rubric-pins";
import { roundNameKey } from "../modules/judging/domain/round-settings";
import { JUDGE_EMAIL, JUDGE_TOKEN } from "../modules/judging/judges";
import { createLinkToken } from "../crypto/link-token";
import { physicallyReadyEntryIds } from "../modules/physical-artwork/readiness";
import { loadJudgeReadiness } from "../modules/judging/judges";
import { ensureGrant } from "./access";
import type { SeedDeps } from "./types";
const id = (n: number) =>
  `01938a00-0000-7000-8000-0000000095${String(n).padStart(2, "0")}`;
export const SEED_JUDGING = {
  draftRoundId: id(1),
  openRoundId: id(2),
  onboardedJudge: {
    id: id(3),
    name: "Sample Onboarded Judge",
    email: "judging-ready@example.test",
  },
  pendingJudge: {
    id: id(4),
    name: "Sample New Judge",
    email: "judging-new@example.test",
  },
  invitedEmail: "judging-invited@example.test",
} as const;
export async function seedJudgingRounds(deps: SeedDeps) {
  const { db, clock, cipher, blindIndex } = deps;
  const [comp] = await db
    .select()
    .from(competition)
    .where(eq(competition.code, "ORIG27"));
  if (!comp) return;
  const now = clock.now();
  const pinning = pinRubrics(
    comp.disciplines,
    await db.select().from(rubric).where(eq(rubric.competitionId, comp.id))
  );
  if (!pinning.ok) return;
  let createdOpenRound = false;
  for (const [roundId, name, status] of [
    [SEED_JUDGING.draftRoundId, "Sample national draft", "draft"],
    [SEED_JUDGING.openRoundId, "Sample national final", "open"],
  ] as const) {
    await db.transaction(async (tx) => {
      const [added] = await tx
        .insert(judgingRound)
        .values({
          id: roundId,
          competitionId: comp.id,
          name,
          nameKey: roundNameKey(name),
          level: "national",
          judgesPhysical: true,
          awardScheme: "ranked_123",
          status,
          createdAt: now,
          updatedAt: now,
          openedAt: status === "open" ? now : null,
        })
        .onConflictDoNothing()
        .returning({ id: judgingRound.id });
      if (added && status === "open") createdOpenRound = true;
      if (added)
        await tx.insert(judgingRoundRubric).values(
          pinning.pins.map((p) => ({
            roundId,
            rubricId: p.rubricId,
            discipline: p.discipline,
          }))
        );
    });
  }
  const roundId = SEED_JUDGING.openRoundId;
  const [round] = await db
    .select()
    .from(judgingRound)
    .where(eq(judgingRound.id, roundId));
  if (!round) return;
  const ready = await ensureVerifiedAccount(deps, SEED_JUDGING.onboardedJudge);
  const pending = await ensureVerifiedAccount(deps, SEED_JUDGING.pendingJudge);
  for (const judge of [ready, pending])
    await ensureGrant(deps, judge.id, {
      role: "judge",
      scope: { type: "round", id: roundId },
    });
  const conduct = await latestDocument(db, "judge_conduct");
  const confidentiality = await latestDocument(db, "judge_confidentiality");
  if (conduct && confidentiality) {
    await db.transaction(async (tx) => {
      await tx
        .insert(consentEvent)
        .values([
          {
            id: id(5),
            subjectType: "user",
            subjectId: ready.id,
            giverUserId: ready.id,
            purpose: "judge_conduct",
            documentId: conduct.id,
            action: "given",
            method: "web_form",
            occurredAt: now,
          },
          {
            id: id(6),
            subjectType: "user",
            subjectId: ready.id,
            giverUserId: ready.id,
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
          judgeUserId: ready.id,
          conductConsentEventId: id(5),
          confidentialityConsentEventId: id(6),
          conflictsDeclaredAt: now,
          conflictsNone: true,
          updatedAt: now,
        })
        .onConflictDoNothing();
    });
  }
  // Preview physical pool is selected through the real readiness check, not
  // inferred from digital verification. Do not populate earlier preview
  // rounds belonging to a different competition or changed by a user.
  if (
    createdOpenRound &&
    round.competitionId === comp.id &&
    round.status === "open" &&
    (await loadJudgeReadiness(db, { roundId, judgeUserId: ready.id })).ready
  ) {
    await db.transaction(async (tx) => {
      const readyIds = [
        ...(await physicallyReadyEntryIds(tx, { competitionId: comp.id })),
      ];
      if (!readyIds.length) return;
      const candidates = await tx
        .select({ id: entry.id })
        .from(entry)
        .where(
          and(
            eq(entry.competitionId, comp.id),
            eq(entry.status, "foa_verified"),
            inArray(entry.id, readyIds)
          )
        );
      if (!candidates.length) return;
      await tx
        .insert(roundEntry)
        .values(
          candidates.map((e) => ({ roundId, entryId: e.id, admittedAt: now }))
        )
        .onConflictDoNothing();
      await tx
        .insert(roundAssignment)
        .values(
          candidates.map((e) => ({
            roundId,
            entryId: e.id,
            judgeUserId: ready.id,
            assignedAt: now,
          }))
        )
        .onConflictDoNothing();
    });
  }
  const link = createLinkToken();
  await db
    .insert(judgeInvitation)
    .values({
      id: id(7),
      roundId,
      emailCiphertext: cipher.encrypt(JUDGE_EMAIL, SEED_JUDGING.invitedEmail),
      emailHash: blindIndex.of(JUDGE_EMAIL, SEED_JUDGING.invitedEmail),
      tokenHash: link.tokenHash,
      tokenCiphertext: cipher.encrypt(JUDGE_TOKEN, link.token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 14 * 86400 * 1000),
    })
    .onConflictDoNothing();
}
