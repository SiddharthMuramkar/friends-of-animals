// Shared set-up for the participants module's Seam 1 tests: a competition
// open to individuals with an adult age group, its individual fee and the
// documents registrants agree to, and an adult's form as they type it.
// Test code only; nothing in the app imports it.

import { asc, eq } from "drizzle-orm";

import { COMPETITION_TERMS_DRAFT } from "@/content/legal/competition-terms-draft";
import type { Actor } from "@/server/actor";
import type { AppDb } from "@/server/db/app-db";
import {
  competitionConsentDocument,
  competitionFee,
  participantProfile,
  registration,
} from "@/server/db/schema";
import { parseConsentDocumentBody } from "@/server/modules/consent/domain/document-body";
import { insertConsentDocumentVersion } from "@/server/modules/consent/insert-version";
import type { SeedBuilders } from "@/server/seed";
import type { SeedCompetitionOptions } from "@/server/seed/competitions";
import type { FakeClock } from "@/test/fakes/clock";
import type { Harness } from "@/test/harness";

import type { RegisterAsIndividualInput } from "./register-input";

/** The sample individual fee: ₹250, in paise. */
export const INDIVIDUAL_FEE = 25_000n;

/** A children's group and an adults' one, counted on 1 June 2027. */
export const AGE_GROUPS = [
  { label: "13–17", minAge: 13, maxAge: 17 },
  { label: "Adults", minAge: 18, maxAge: 99 },
];

/** What setting up a competition needs: the harness, or a real-Postgres world. */
type World = { db: AppDb; seed: SeedBuilders; clock: FakeClock };

/** The guardian consent documents a competition can attach (#82). */
export type GuardianDocumentPurpose =
  | "participation"
  | "public_display"
  | "social_media"
  | "auction";

/** Publishes the next version of `purpose` straight into the table. */
export async function publishedDocument(
  h: World,
  purpose: "competition_terms" | "privacy_notice" | GuardianDocumentPurpose
): Promise<string> {
  const { title: _title, ...body } = COMPETITION_TERMS_DRAFT;
  const parsed = parseConsentDocumentBody(body);
  if (!parsed.ok) throw new Error(parsed.issues.join("; "));
  const { id } = await h.db.transaction((tx) =>
    insertConsentDocumentVersion(
      tx,
      { now: h.clock.now(), publishedByUserId: null },
      {
        purpose,
        title: `Draft ${purpose}`,
        body: parsed.body,
        legalRevisionId: null,
      }
    )
  );
  return id;
}

/**
 * A competition taking individuals and schools, with registration open
 * now, the individual fee `fee` (none when null), and the competition
 * terms and privacy notice attached, both required, then the guardian
 * documents asked for (by default participation, which a guardian
 * registering a child consents to on the form, #82). `documents` holds
 * every attached version, as a form with every box ticked sends them.
 */
export async function openToIndividuals(
  h: World,
  {
    fee = INDIVIDUAL_FEE,
    guardianDocuments = ["participation"],
    ...options
  }: SeedCompetitionOptions & {
    fee?: bigint | null;
    guardianDocuments?: readonly GuardianDocumentPurpose[];
  } = {}
) {
  const competition = await h.seed.competition({
    status: "registration_open",
    participation: "both",
    ageGroups: AGE_GROUPS,
    ageCutoffDate: "2027-06-01",
    ...options,
  });
  if (fee !== null) {
    await h.db.insert(competitionFee).values({
      competitionId: competition.id,
      route: "individual",
      amountMinor: fee,
      updatedAt: h.clock.now(),
    });
  }
  const documents: string[] = [];
  const attached: Partial<Record<GuardianDocumentPurpose, string>> = {};
  for (const purpose of [
    "competition_terms",
    "privacy_notice",
    ...guardianDocuments,
  ] as const) {
    const [pinned] = await h.db
      .select({ id: competitionConsentDocument.consentDocumentId })
      .from(competitionConsentDocument)
      .where(eq(competitionConsentDocument.purpose, purpose))
      .limit(1);
    const documentId = pinned?.id ?? (await publishedDocument(h, purpose));
    await h.db.insert(competitionConsentDocument).values({
      competitionId: competition.id,
      purpose,
      consentDocumentId: documentId,
      attachedAt: h.clock.now(),
    });
    documents.push(documentId);
    if (purpose !== "competition_terms" && purpose !== "privacy_notice") {
      attached[purpose] = documentId;
    }
  }
  return { ...competition, documents, guardianDocuments: attached };
}

export type OpenCompetition = Awaited<ReturnType<typeof openToIndividuals>>;

/** An adult's register form, as they type it, agreeing to every document. */
export function adultForm(
  competition: OpenCompetition,
  change: Partial<RegisterAsIndividualInput> = {}
): RegisterAsIndividualInput {
  return {
    competitionSlug: competition.slug,
    fullName: "Asha  Rao",
    dateOfBirth: "1994-05-12",
    phone: "90000 00777",
    pinCode: "411 038",
    city: "Pune",
    state: "Maharashtra",
    country: "IN",
    schoolName: "",
    consents: competition.documents,
    ...change,
  };
}

/** A signed-in member with no roles. */
export async function signInMember(
  h: Harness,
  details: { name?: string; email?: string } = {}
): Promise<{ actor: Actor; userId: string; email: string }> {
  const member = await h.seed.member(details);
  return {
    actor: await h.signIn(member),
    userId: member.id,
    email: member.email,
  };
}

/** Every profile and registration, to show a refusal wrote nothing. */
export async function participantRows(h: Harness) {
  return {
    profiles: await h.db
      .select()
      .from(participantProfile)
      .orderBy(asc(participantProfile.id)),
    registrations: await h.db
      .select()
      .from(registration)
      .orderBy(asc(registration.id)),
  };
}
