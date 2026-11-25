// Synthetic accounts who actually took part in AUCT27. The seed only
// gives the initial optional messages consent; a later withdrawal stays.
import { and, eq } from "drizzle-orm";
import { consentEvent, survey, user } from "../db/schema";
import { latestDocument } from "../modules/consent/repository";
import { SEED_RESULTS } from "./results";
import { SEED_AUCTIONS } from "./auctions";
import type { Seeder } from "./types";

export const SEED_FEEDBACK = {
  competitionId: SEED_RESULTS.competitionId,
  title: "Art competition feedback",
  id: "01938a00-0000-7000-8000-000000134001",
  questions: [
    {
      text: "How did you find the competition?",
      choices: ["Excellent", "Good", "Could improve"],
    },
    { text: "Would you take part again?", choices: ["Yes", "No"] },
  ],
};
export const seedSurveys: Seeder = async ({ db, clock }) => {
  const doc = await latestDocument(db, "messages");
  if (!doc) return;
  const accounts = [
    SEED_AUCTIONS.artist,
    SEED_AUCTIONS.mobileArtist,
    SEED_AUCTIONS.otherArtist,
  ];
  for (const [i, account] of accounts.entries()) {
    const [actual] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, account.email));
    if (!actual) continue;
    const [existing] = await db
      .select({ id: consentEvent.id })
      .from(consentEvent)
      .where(
        and(
          eq(consentEvent.subjectId, actual.id),
          eq(consentEvent.subjectType, "user"),
          eq(consentEvent.purpose, "messages")
        )
      )
      .limit(1);
    if (!existing)
      await db
        .insert(consentEvent)
        .values({
          id: `01938a00-0000-7000-8000-00000013400${i + 2}`,
          subjectType: "user",
          subjectId: actual.id,
          giverUserId: actual.id,
          purpose: "messages",
          documentId: doc.id,
          action: "given",
          method: "web_form",
          occurredAt: clock.now(),
        })
        .onConflictDoNothing();
  }
  await db
    .insert(survey)
    .values({
      ...SEED_FEEDBACK,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    })
    .onConflictDoNothing();
};
