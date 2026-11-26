import { eq } from "drizzle-orm";
import { competition, judgingRound, resultRelease } from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { DbWithClock } from "../../db/app-db";
import { publishResultsRelease, snapshotHash } from "../results/releases";

// A historical locked final round and approved immutable release, with no
// awarded entries. Publish it through the actual #99 worker authority.
export async function publishFixture(
  { db, clock }: DbWithClock,
  competitionId: string
) {
  const now = clock.now();
  const earlier = new Date(now.getTime() - 86400000);
  const roundId = uuidv7(now);
  const releaseId = uuidv7(now);
  await db.insert(judgingRound).values({
    id: roundId,
    competitionId,
    name: "Final",
    nameKey: "final",
    status: "locked",
    lockedAt: earlier,
    tieBreakRule: "fixture",
    createdAt: earlier,
    updatedAt: earlier,
  });
  const release = {
    id: releaseId,
    competitionId,
    sourceRoundId: roundId,
    preparedAt: earlier,
    approvedAt: earlier,
    publishAt: now,
    deliveryNote: "",
  };
  await db.insert(resultRelease).values({
    ...release,
    status: "approved",
    contentHash: snapshotHash(release, []),
  });
  await db
    .update(competition)
    .set({ status: "foa_judging" })
    .where(eq(competition.id, competitionId));
  const published = await publishResultsRelease(
    { db, clock, actor: { kind: "system", process: "worker" } },
    { competitionId, releaseId }
  );
  if (!published.ok || published.outcome !== "published")
    throw new Error("Fixture could not publish");
}
