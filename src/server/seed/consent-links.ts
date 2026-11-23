// Synthetic local and preview evidence. No mail is queued during seeding.
import { and, eq, inArray } from "drizzle-orm";

import { createLinkToken } from "../crypto/link-token";
import { consentLink, registration } from "../db/schema";
import { appendConsentEvent } from "../modules/consent/consents";
import { lockProfileSubject } from "../modules/consent/repository";
import { linkExpiresAt } from "../modules/consent-links/domain/link";
import type { Answer } from "../modules/consent-links/domain/answers";
import { offeredPublicUses } from "../modules/consent-links/offered-uses";
import {
  LINK_CONTACT,
  LINK_TOKEN,
  schoolRegistration,
} from "../modules/consent-links/repository";
import { SEED_REGISTRATIONS, SEED_STUDENTS } from "./registration";
import type { SeedDeps } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const EXAMPLES = [
  {
    id: "01938a00-0000-7000-8083-000000000001",
    student: SEED_STUDENTS[0]!,
    ageInDays: 1,
    answered: true,
  },
  {
    id: "01938a00-0000-7000-8083-000000000002",
    student: SEED_STUDENTS[1]!,
    ageInDays: 1,
    answered: false,
  },
  {
    id: "01938a00-0000-7000-8083-000000000003",
    student: SEED_STUDENTS[2]!,
    ageInDays: 8,
    answered: false,
  },
] as const;

export async function seedConsentLinks(deps: SeedDeps) {
  const school = await schoolRegistration(deps.db, {
    id: SEED_REGISTRATIONS.institution.id,
  });
  if (!school) return;
  const offers = await offeredPublicUses(deps.db, school.competition);
  const display = offers.find(({ purpose }) => purpose === "public_display");
  if (!display || !offers.some(({ purpose }) => purpose === "social_media"))
    return;

  for (const { id, student, ageInDays, answered } of EXAMPLES) {
    await deps.db.transaction(async (tx) => {
      await lockProfileSubject(tx, student.profileId);
      const [entry] = await tx
        .select({ id: registration.id })
        .from(registration)
        .where(
          and(
            eq(registration.id, student.registrationId),
            eq(registration.participantProfileId, student.profileId),
            eq(registration.institutionRegistrationId, school.id),
            inArray(registration.status, ["enrolled", "confirmed"])
          )
        );
      if (!entry) return;
      const now = deps.clock.now();
      const sentAt = new Date(now.getTime() - ageInDays * DAY);
      const { token, tokenHash } = createLinkToken();
      const contactHash = deps.blindIndex.of(
        LINK_CONTACT,
        student.guardianEmail
      );
      const choices = offers.map(({ purpose }) => {
        const answer: Answer =
          purpose === "public_display" ? "give" : "decline";
        return [purpose, answer] as const;
      });
      const [created] = await tx
        .insert(consentLink)
        .values({
          id,
          participantProfileId: student.profileId,
          studentRegistrationId: entry.id,
          institutionRegistrationId: school.id,
          competitionId: school.competition.id,
          status: answered ? "used" : "pending",
          channel: "email",
          contactHash,
          contactCiphertext: deps.cipher.encrypt(
            LINK_CONTACT,
            student.guardianEmail
          ),
          tokenHash,
          tokenCiphertext:
            answered || ageInDays >= 7
              ? null
              : deps.cipher.encrypt(LINK_TOKEN, token),
          sentAt,
          expiresAt: linkExpiresAt(sentAt),
          offeredUses: offers,
          answers: answered ? Object.fromEntries(choices) : null,
          usedAt: answered ? now : null,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: consentLink.id });

      if (created && answered) {
        await appendConsentEvent(
          tx,
          {
            db: tx,
            clock: deps.clock,
            actor: { kind: "system", process: "seed" },
          },
          { status: "never" },
          {
            subject: { type: "participant_profile", id: student.profileId },
            competitionId: school.competition.id,
            documentId: display.documentId,
            purpose: display.purpose,
            action: "given",
            method: "otp_link",
            giver: { kind: "guardian_contact", contactHash, consentLinkId: id },
          }
        );
      }
    });
  }
}
