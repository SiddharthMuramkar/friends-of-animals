// Inserting the next version of a consent document: #64's publish and the
// CMS's mirror of the privacy and terms pages (#111) both go through here,
// so versions number the same way. The caller authorises, opens the
// transaction and writes its own audit entry.
//
// Loads under plain Node: relative imports only.

import { MESSAGES_CONSENT_DRAFT } from "../../../content/legal/messages-consent";
import type { AppDb } from "../../db/app-db";
import { consentDocument } from "../../db/schema";
import { uuidv7 } from "../../ids";
import type { ConsentDocumentBody } from "./domain/document-body";
import type { ConsentPurpose } from "./domain/purposes";
import { latestDocument, type DocumentRow } from "./repository";

/** The title a purpose's first version gets when the caller names none. */
const FIRST_TITLES: Record<ConsentPurpose, string> = {
  privacy_notice: "Privacy policy",
  terms: "Terms of use",
  messages: MESSAGES_CONSENT_DRAFT.title,
  competition_terms: "Competition terms",
  participation: "Consent to take part",
  public_display: "Consent to show the work in public",
  display_school: "Consent to show the school",
  display_city: "Consent to show the city",
  social_media: "Consent to share the work on social media",
  auction: "Consent to auction the artwork",
  communications: "Consent to messages about the child",
  volunteer_safeguarding_declaration: "Volunteer safeguarding declaration",
  volunteer_code_of_conduct: "Volunteer code of conduct",
};

export type ConsentVersionInput = {
  purpose: ConsentPurpose;
  /** null keeps the latest version's title (or the purpose's first title). */
  title: string | null;
  body: ConsentDocumentBody;
  /** The policy page revision this version rests on (#111), if any. */
  legalRevisionId: string | null;
};

/**
 * Inserts the purpose's next version, published now by the acting user.
 * Returns it and the version it follows. Run it in a transaction: the
 * unique (purpose, version) key refuses a racing publish.
 */
export async function insertConsentDocumentVersion(
  tx: AppDb,
  { now, publishedByUserId }: { now: Date; publishedByUserId: string | null },
  input: ConsentVersionInput
): Promise<{ id: string; version: number; previous: DocumentRow | null }> {
  const previous = await latestDocument(tx, input.purpose);
  const id = uuidv7(now);
  const version = (previous?.version ?? 0) + 1;
  await tx.insert(consentDocument).values({
    id,
    purpose: input.purpose,
    version,
    title: input.title ?? previous?.title ?? FIRST_TITLES[input.purpose],
    body: input.body,
    publishedAt: now,
    publishedByUserId,
    legalRevisionId: input.legalRevisionId,
  });
  return { id, version, previous };
}
