import { legalHold } from "../db/schema";
import { SEED_INSTITUTIONS } from "./institutions";
import type { SeedDeps } from "./types";

/** One example hold on the seeded institution for the privacy admin page. */
export async function seedPrivacy({ db, clock }: SeedDeps): Promise<void> {
  await db
    .insert(legalHold)
    .values({
      id: "01938a00-0000-7000-8114-000000000001",
      subjectType: "institution",
      subjectId: SEED_INSTITUTIONS.verified.id,
      reason: "Example hold for a pending inquiry.",
      placedAt: clock.now(),
    })
    .onConflictDoNothing();
}
