// Consent seed data (#64): version 1 of the privacy notice, the terms and
// the messages consent, published by the seeded super admin, so previews
// show versioned legal pages and ask for consent at sign-up. The privacy
// and terms bodies are the repo's policy text, every clause kept (a
// preview shows unconfirmed facts as tiles); the messages consent is a
// draft (HR-20). Production gets no seed: staff publish version 1 there
// once counsel approves the words. Loads under plain Node (the seed
// script): relative imports only, no "server-only".

import { LEGAL_DOCS } from "../../content/legal";
import { MESSAGES_CONSENT_DRAFT } from "../../content/legal/messages-consent";
import {
  parseConsentDocumentBody,
  toConsentDocumentBody,
} from "../modules/consent/domain/document-body";
import type { ConsentPurpose } from "../modules/consent/domain/purposes";
import { consentDocument } from "../db/schema";
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
        body: parsed.body,
        publishedAt: now,
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
