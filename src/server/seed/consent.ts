import { withAuctionShare } from "../modules/consent/domain/auction-proceeds";
// Consent seed data (#64): version 1 of the privacy notice, the terms and
// the messages consent, published by the seeded super admin, so previews
// show versioned legal pages and ask for consent at sign-up; and (#82)
// draft versions of the guardian consent documents, and (#123) of the
// volunteer declarations. The privacy
// and terms bodies are the repo's policy text, every clause kept (a
// preview shows unconfirmed facts as tiles); the messages consent is a
// draft (HR-20). Production gets no seed: staff publish version 1 there
// once counsel approves the words. Loads under plain Node (the seed
// script): relative imports only, no "server-only".

import { LEGAL_DOCS } from "../../content/legal";
import { GUARDIAN_CONSENT_DRAFTS } from "../../content/legal/guardian-consents";
import { MESSAGES_CONSENT_DRAFT } from "../../content/legal/messages-consent";
import { VOLUNTEER_DECLARATION_DRAFTS } from "../../content/legal/volunteer-declarations";
import { ADOPTION_CONSENT_DRAFTS } from "../../content/legal/adoption-consents";
import {
  parseConsentDocumentBody,
  toConsentDocumentBody,
} from "../modules/consent/domain/document-body";
import { and, desc, eq } from "drizzle-orm";

import type { AppDb } from "../db/app-db";
import type { GuardianPurpose } from "../modules/consent/domain/guardian-purposes";
import type { ConsentPurpose } from "../modules/consent/domain/purposes";
import { participationGiven } from "../modules/consent/participation-gate";
import {
  competition,
  competitionConsentDocument,
  consentDocument,
  consentEvent,
  participantProfile,
  registration,
} from "../db/schema";
import { ageGroupFor } from "../modules/registration/domain/age-group";
import { parseIsoDate } from "../modules/registration/domain/calendar-date";
import { ageGroupsOf } from "../modules/registration/enrolment-facts";
import { PROFILE_PURPOSE } from "../modules/registration/student-profile";
import { SEED_TERMS_COMPETITIONS } from "./competition-terms";
import { SEED_GUARDIANS } from "./guardians";
import { uuidv7 } from "../ids";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { ensureGrant } from "./access";
import { SEED_ACCOUNTS, SEED_CONSENT_PUBLISHERS } from "./accounts";
import { ensureSeedAuthenticator } from "./second-factor";
import type { SeedDeps } from "./types";

const SEED_DOCUMENTS: ReadonlyArray<{
  purpose: ConsentPurpose;
  title: string;
  body: unknown;
}> = [
  {
    purpose: "privacy_notice",
    title: "Privacy policy",
    body: toConsentDocumentBody(LEGAL_DOCS.privacy),
  },
  {
    purpose: "terms",
    title: "Terms of use",
    body: toConsentDocumentBody(LEGAL_DOCS.terms),
  },
  {
    purpose: "messages",
    title: MESSAGES_CONSENT_DRAFT.title,
    body: {
      short: MESSAGES_CONSENT_DRAFT.short,
      sections: MESSAGES_CONSENT_DRAFT.sections,
    },
  },
  // The documents a guardian consents to for a child (#82), drafts too
  // (HR-33); the competition terms seed attaches them.
  ...Object.entries(GUARDIAN_CONSENT_DRAFTS).map(([purpose, draft]) => ({
    purpose: purpose as keyof typeof GUARDIAN_CONSENT_DRAFTS,
    title: draft.title,
    body: { short: draft.short, sections: draft.sections },
  })),
  // The volunteer declarations (#123), drafts too (HR-55).
  ...Object.entries(VOLUNTEER_DECLARATION_DRAFTS).map(([purpose, draft]) => ({
    purpose: purpose as keyof typeof VOLUNTEER_DECLARATION_DRAFTS,
    title: draft.title,
    body: { short: draft.short, sections: draft.sections },
  })),
  ...(["judge_conduct", "judge_confidentiality"] as const).map((purpose) => ({
    purpose,
    title:
      purpose === "judge_conduct"
        ? "Sample judge code of conduct (HR-39)"
        : "Sample judge confidentiality terms (HR-39)",
    body: {
      short: [
        ["Preview sample only. FOA must approve the final wording before use."],
      ],
      sections: [
        {
          id: "sample-terms",
          title: "Sample terms",
          blocks: [
            {
              p: [
                purpose === "judge_conduct"
                  ? "Judge fairly and respectfully. Declare conflicts of interest and follow safeguarding procedures."
                  : "Keep entries and judging deliberations private. Do not seek or disclose the identity of participants.",
              ],
            },
          ],
        },
      ],
    },
  })),
  // An adopter's consents (#130), drafts too (HR-61).
  ...Object.entries(ADOPTION_CONSENT_DRAFTS).map(([purpose, draft]) => ({
    purpose: purpose as keyof typeof ADOPTION_CONSENT_DRAFTS,
    title: draft.title,
    body: { short: draft.short, sections: draft.sections },
  })),
];

/**
 * Version 1 of each seeded document and publishers for the consent
 * journeys. Seed data writes no audit entry.
 */
export async function seedConsent(deps: SeedDeps): Promise<void> {
  const { db, clock } = deps;
  const publisher = await ensureVerifiedAccount(deps, SEED_ACCOUNTS.superAdmin);
  const now = clock.now();
  for (const { purpose, title, body } of SEED_DOCUMENTS) {
    const parsed = parseConsentDocumentBody(body);
    if (!parsed.ok) {
      throw new Error(
        `The seeded ${purpose} document is invalid: ${parsed.issues.join("; ")}`
      );
    }
    await db
      .insert(consentDocument)
      .values({
        id: uuidv7(now),
        purpose,
        version: 1,
        title,
        body:
          purpose === "auction"
            ? withAuctionShare(parsed.body, 0)
            : parsed.body,
        publishedAt:
          purpose === "auction" ? new Date(+now - 200 * 86400000) : now,
        publishedByUserId: publisher.id,
      })
      .onConflictDoNothing();
  }

  for (const { role, ...account } of Object.values(SEED_CONSENT_PUBLISHERS)) {
    const { id } = await ensureVerifiedAccount(deps, account);
    await ensureGrant(deps, id, { role, scope: { type: "global" } });
    await ensureSeedAuthenticator(deps, id);
  }
}

/**
 * The guardian's children's consents (#82): both registered for
 * Neighbours on My Street (NEIGH27), where the under-13 child has
 * participation, public display and city given (school never) and the
 * linked teen participation and social media, with public display given
 * then withdrawn; the under-13 child also has communications. Runs after
 * the guardians seed. Existing consent choices are preserved, and a new
 * registration waits for payment only with current participation consent.
 */
export const SEED_CHILD_CONSENTS = {
  young: {
    profileId: SEED_GUARDIANS.children.young.profileId,
    registrationId: "01938a00-0000-7000-8000-000000008161",
    participantCode: "FOA-P-26D08121",
    schoolName: "Green Valley School",
    plan: [
      ["participation", "given"],
      ["public_display", "given"],
      ["display_city", "given"],
      ["communications", "given"],
    ],
  },
  teen: {
    profileId: SEED_GUARDIANS.children.teen.profileId,
    registrationId: "01938a00-0000-7000-8000-000000008162",
    participantCode: "FOA-P-26D08122",
    schoolName: null,
    plan: [
      ["participation", "given"],
      ["social_media", "given"],
      ["public_display", "given"],
      ["public_display", "withdrawn"],
    ],
  },
} as const satisfies Record<
  string,
  {
    profileId: string;
    registrationId: string;
    participantCode: string;
    schoolName: string | null;
    plan: readonly (readonly [GuardianPurpose, "given" | "withdrawn"])[];
  }
>;

/** The version each purpose's consent points at for NEIGH27. */
async function seededDocuments(
  db: AppDb,
  competitionId: string
): Promise<Partial<Record<GuardianPurpose, string>>> {
  const pinned = await db
    .select({
      purpose: competitionConsentDocument.purpose,
      id: competitionConsentDocument.consentDocumentId,
    })
    .from(competitionConsentDocument)
    .where(eq(competitionConsentDocument.competitionId, competitionId));
  const of = (purpose: string) =>
    pinned.find((row) => row.purpose === purpose)?.id;
  const [communications] = await db
    .select({ id: consentDocument.id })
    .from(consentDocument)
    .where(eq(consentDocument.purpose, "communications"))
    .orderBy(desc(consentDocument.version))
    .limit(1);
  return {
    participation: of("participation"),
    public_display: of("public_display"),
    display_school: of("public_display"),
    display_city: of("public_display"),
    social_media: of("social_media"),
    auction: of("auction"),
    communications: communications?.id,
  };
}

export async function seedChildConsents(deps: SeedDeps): Promise<void> {
  const competitionId = SEED_TERMS_COMPETITIONS.paid;
  const now = deps.clock.now();

  await deps.db.transaction(async (tx) => {
    const [target] = await tx
      .select({ ageCutoffDate: competition.ageCutoffDate })
      .from(competition)
      .where(eq(competition.id, competitionId))
      .for("share");
    const cutoff = target?.ageCutoffDate && parseIsoDate(target.ageCutoffDate);
    if (!cutoff) return;
    const giver = await ensureVerifiedAccount(
      { ...deps, db: tx },
      SEED_GUARDIANS.guardian
    );
    const groups = await ageGroupsOf(tx, competitionId);
    const documents = await seededDocuments(tx, competitionId);

    for (const seed of Object.values(SEED_CHILD_CONSENTS)) {
      const [profile] = await tx
        .select({
          id: participantProfile.id,
          dobCiphertext: participantProfile.dobCiphertext,
          participantCode: participantProfile.participantCode,
        })
        .from(participantProfile)
        .where(
          and(
            eq(participantProfile.id, seed.profileId),
            eq(participantProfile.ownerUserId, giver.id),
            eq(participantProfile.ownerKind, "guardian")
          )
        )
        .for("no key update");
      if (!profile) continue;
      const dateOfBirth = parseIsoDate(
        deps.cipher.decrypt(PROFILE_PURPOSE.dob, profile.dobCiphertext)
      );
      const placed = dateOfBirth && ageGroupFor(dateOfBirth, cutoff, groups);
      if (!placed || !placed.ok) continue;
      if (profile.participantCode === null) {
        await tx
          .update(participantProfile)
          .set({
            participantCode: seed.participantCode,
            pinCode: "411038",
            city: "Pune",
            state: "Maharashtra",
            country: "IN",
            schoolName: seed.schoolName,
            updatedAt: now,
          })
          .where(eq(participantProfile.id, profile.id));
      }

      const [logged] = await tx
        .select({ id: consentEvent.id })
        .from(consentEvent)
        .where(
          and(
            eq(consentEvent.subjectType, "participant_profile"),
            eq(consentEvent.subjectId, profile.id)
          )
        )
        .limit(1);
      if (!logged) {
        let at = now.getTime() - seed.plan.length * 60_000;
        for (const [purpose, action] of seed.plan) {
          const documentId = documents[purpose];
          if (!documentId) continue;
          const occurredAt = new Date(at);
          at += 60_000;
          await tx.insert(consentEvent).values({
            id: uuidv7(occurredAt),
            subjectType: "participant_profile",
            subjectId: profile.id,
            giverUserId: giver.id,
            purpose,
            competitionId: purpose === "communications" ? null : competitionId,
            documentId,
            action,
            method: "web_form",
            occurredAt,
          });
        }
      }
      const given = await participationGiven(tx, profile.id, competitionId);
      await tx
        .insert(registration)
        .values({
          id: seed.registrationId,
          participantProfileId: profile.id,
          competitionId,
          route: "individual",
          ageGroupId: placed.group.id,
          status: given ? "pending_payment" : "pending_guardian",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
  });
}
