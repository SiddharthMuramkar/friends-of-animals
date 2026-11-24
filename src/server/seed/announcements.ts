// Announcements seed data (#84): on the open competition (NEIGH27), one
// announcement sent two days before the seed first ran, to as many people
// as its registrations reach then, and one draft for the composer and the
// preview. Seed data sends nothing: no event is written, so nobody is
// messaged. Idempotent: rows already there are left alone.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { eq } from "drizzle-orm";

import { announcement, competition } from "../db/schema";
import { HELP_CONTACTS_PURPOSE } from "../db/schema/announcements";
import { loadAnnouncementDeliveryPlan } from "../modules/announcements/delivery-plan";
import { databaseSettings } from "../modules/settings/read";
import { SEED_COMPETITION_MANAGER } from "./competitions";
import type { SeedDeps } from "./types";

export const SEED_ANNOUNCEMENTS = {
  /** NEIGH27, the competitions seed's open competition. */
  competitionId: "01938a00-0000-7000-8000-000000002101",
  sent: { id: "01938a00-0000-7000-8000-000000008401" },
  draft: { id: "01938a00-0000-7000-8000-000000008402" },
} as const;

const DAY = 24 * 60 * 60 * 1000;

export async function seedAnnouncements(deps: SeedDeps): Promise<void> {
  const [target] = await deps.db
    .select({ id: competition.id })
    .from(competition)
    .where(eq(competition.id, SEED_ANNOUNCEMENTS.competitionId));
  if (!target) return;
  const now = deps.clock.now();
  const sentAt = new Date(now.getTime() - 2 * DAY);
  const { counts } = await loadAnnouncementDeliveryPlan(
    deps,
    target.id,
    sentAt,
    await databaseSettings(deps.db).get("sms.enabled")
  );

  await deps.db
    .insert(announcement)
    .values([
      {
        id: SEED_ANNOUNCEMENTS.sent.id,
        competitionId: target.id,
        status: "sent",
        subject: "Registration is open: what happens next",
        confirmedTheme: "Neighbours on my street: the animals we live beside",
        deadlines:
          "Registration closes on the date on the competition page. Uploads open after that.",
        helpContactsCiphertext: deps.cipher.encrypt(
          HELP_CONTACTS_PURPOSE,
          "Write to us through the contact page."
        ),
        message: "Thank you for taking part, and for being kind to animals.",
        createdBy: SEED_COMPETITION_MANAGER.id,
        createdAt: new Date(now.getTime() - 3 * DAY),
        updatedAt: sentAt,
        sentBy: SEED_COMPETITION_MANAGER.id,
        sentAt,
        recipientCount: counts.recipients,
      },
      {
        id: SEED_ANNOUNCEMENTS.draft.id,
        competitionId: target.id,
        status: "draft",
        subject: "Phase 3: the drawing day",
        eventAt: new Date(now.getTime() + 30 * DAY),
        permittedMaterials: "Pencils, crayons and watercolours on A3 paper.",
        duration: "Two hours.",
        submissionSteps:
          "Photograph your drawing in daylight.\nUpload it from your dashboard.",
        physicalArtworkRequirements:
          "Keep the original drawing: FOA may ask for it after judging.",
        helpContactsCiphertext: deps.cipher.encrypt(
          HELP_CONTACTS_PURPOSE,
          "Write to us through the contact page."
        ),
        createdBy: SEED_COMPETITION_MANAGER.id,
        createdAt: new Date(now.getTime() - 60 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 60 * 60 * 1000),
      },
    ])
    .onConflictDoNothing({ target: announcement.id });
}
