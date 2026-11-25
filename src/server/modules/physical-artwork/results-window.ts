// Publication is an internal domain event, emitted by #99 from the
// transaction that makes the release public. No browser use case can
// open or reset a return window.
import { artworkResultsWindow } from "../../db/schema";
import type { OutboxDeps } from "../../outbox";
import { emit } from "../../outbox/emit";
import { returnWindowFor } from "./domain/custody";

export async function openArtworkResultsWindow(
  deps: OutboxDeps,
  input: { competitionId: string; releaseId: string; publishedAt: string }
) {
  const publishedAt = new Date(input.publishedAt);
  if (publishedAt > deps.clock.now())
    throw new Error("Results publication cannot be in the future");
  const days = await deps.settings.get("artwork.returnWindowDays");
  const window = returnWindowFor(publishedAt, days);
  await deps.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(artworkResultsWindow)
      .values({
        competitionId: input.competitionId,
        releaseId: input.releaseId,
        resultsPublishedAt: window.opensAt,
        closesAt: window.closesAt,
      })
      .onConflictDoNothing()
      .returning({ id: artworkResultsWindow.competitionId });
    if (!inserted.length) return;
    await emit(
      tx,
      deps.clock,
      {
        type: "artwork.retain_unrequested",
        aggregate: { type: "competition", id: input.competitionId },
        payload: { competitionId: input.competitionId },
      },
      { availableAt: window.closesAt }
    );
  });
}
