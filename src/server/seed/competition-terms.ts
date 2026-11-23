// Competition terms seed data (#72): fees, an award scheme and attached
// documents on two of the seeded competitions, so previews show both a
// free and a paid competition. Version 1 of the draft competition terms
// (HR-33) is seeded here; the privacy notice's comes from seedConsent.
// Amounts are obviously samples, not FOA's prices (HR-34). Idempotent:
// rows already there are left alone. Loads under plain Node (the seed
// script): relative imports only, no "server-only".

import { and, eq } from "drizzle-orm";

import { COMPETITION_TERMS_DRAFT } from "../../content/legal/competition-terms-draft";
import { parseConsentDocumentBody } from "../modules/consent/domain/document-body";
import {
  competitionAwardScheme,
  competitionConsentDocument,
  competitionFee,
  consentDocument,
} from "../db/schema";
import { uuidv7 } from "../ids";
import type { AttachablePurpose } from "../modules/competitions/domain/consent-attachments";
import { SEED_ACCOUNTS } from "./accounts";
import { ensureVerifiedAccount } from "../identity/verified-account";
import type { SeedDeps } from "./types";

/** The seeded competitions that get terms (from ./competitions.ts). */
export const SEED_TERMS_COMPETITIONS = {
  /** Neighbours on My Street: individuals and institutions, paid. */
  paid: "01938a00-0000-7000-8000-000000002101",
  /** A Bowl of Water: individuals only, free. */
  free: "01938a00-0000-7000-8000-000000002102",
} as const;

// Sample amounts, not FOA's prices (HR-34): ₹100 and ₹1,000.
const SAMPLE_FEES = [
  {
    competitionId: SEED_TERMS_COMPETITIONS.paid,
    route: "individual",
    paise: 10_000n,
  },
  {
    competitionId: SEED_TERMS_COMPETITIONS.paid,
    route: "institution",
    paise: 100_000n,
  },
  {
    competitionId: SEED_TERMS_COMPETITIONS.free,
    route: "individual",
    paise: 0n,
  },
] as const;

const ATTACHED: readonly AttachablePurpose[] = [
  "competition_terms",
  "privacy_notice",
  // The guardian consent documents (#82), as drafts (HR-33).
  "participation",
  "public_display",
  "social_media",
  "auction",
];

async function ensureCompetitionTermsV1(deps: SeedDeps): Promise<void> {
  const { db, clock } = deps;
  const publisher = await ensureVerifiedAccount(deps, SEED_ACCOUNTS.superAdmin);
  const { title, ...body } = COMPETITION_TERMS_DRAFT;
  const parsed = parseConsentDocumentBody(body);
  if (!parsed.ok) {
    throw new Error(
      `The seeded competition terms are invalid: ${parsed.issues.join("; ")}`
    );
  }
  const now = clock.now();
  await db
    .insert(consentDocument)
    .values({
      id: uuidv7(now),
      purpose: "competition_terms",
      version: 1,
      title,
      body: parsed.body,
      publishedAt: now,
      publishedByUserId: publisher.id,
    })
    .onConflictDoNothing();
}

async function versionOneOf(
  deps: SeedDeps,
  purpose: AttachablePurpose
): Promise<string | undefined> {
  const [row] = await deps.db
    .select({ id: consentDocument.id })
    .from(consentDocument)
    .where(
      and(eq(consentDocument.purpose, purpose), eq(consentDocument.version, 1))
    );
  return row?.id;
}

export async function seedCompetitionTerms(deps: SeedDeps): Promise<void> {
  const { db, clock } = deps;
  const now = clock.now();
  await ensureCompetitionTermsV1(deps);

  await db
    .insert(competitionFee)
    .values(
      SAMPLE_FEES.map(({ competitionId, route, paise }) => ({
        competitionId,
        route,
        amountMinor: paise,
        updatedAt: now,
      }))
    )
    .onConflictDoNothing();

  // One round off the default, so previews show a non-default scheme.
  await db
    .insert(competitionAwardScheme)
    .values({
      competitionId: SEED_TERMS_COMPETITIONS.paid,
      round: "school",
      scheme: "medals_gsb",
      prizes: { gold: "Sample prize: a trophy and art supplies" },
      updatedAt: now,
    })
    .onConflictDoNothing();

  for (const purpose of ATTACHED) {
    const documentId = await versionOneOf(deps, purpose);
    if (documentId === undefined) {
      throw new Error(`No version 1 of ${purpose} to attach`);
    }
    await db
      .insert(competitionConsentDocument)
      .values(
        Object.values(SEED_TERMS_COMPETITIONS).map((competitionId) => ({
          competitionId,
          purpose,
          consentDocumentId: documentId,
          attachedAt: now,
        }))
      )
      .onConflictDoNothing();
  }
}
