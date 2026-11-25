import { queuePublishedInvitations } from "../modules/invitations/queue";
import { publishedRelease } from "../modules/results/read-published";
import { SEED_RESULTS } from "./results";
import type { Seeder } from "./types";

// Only the synthetic AUCT27 preview, not a general historical sweep. The
// survey seed establishes consent for the actual seeded adult participants.
export const seedCompetitionInvitations: Seeder = async (deps) => {
  const release = await publishedRelease(deps.db, SEED_RESULTS.competitionId);
  if (!release) return;
  await queuePublishedInvitations(
    { ...deps, actor: { kind: "system", process: "worker" } },
    {
      competitionId: release.competitionId,
      releaseId: release.releaseId,
      publishedAt: release.publishedAt.toISOString(),
    }
  );
};
