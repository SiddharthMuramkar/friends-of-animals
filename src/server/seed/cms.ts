// CMS seed data (#111): every document row, and version 1 of each document
// whose kind is built, with the repo's copy as its body (the four policy
// pages: the same text #64's seed publishes as the privacy notice and
// terms). Seed data, not a staff action: no audit entry and no publisher.
// A document that already has a revision is left alone, so seeding again,
// or after a content manager published, changes nothing. Production gets
// no seed: content managers publish there once counsel approves (HR-50).
// Loads under plain Node (the seed script): relative imports only.

import { eq } from "drizzle-orm";

import { cmsRevision } from "../db/schema";
import { CMS_DOCUMENT_KEYS } from "../modules/cms/domain/documents";
import { kindOf } from "../modules/cms/kinds";
import { ensureDocument } from "../modules/cms/repository";
import { uuidv7 } from "../ids";
import type { SeedDeps } from "./types";

export async function seedCms({ db, clock }: SeedDeps): Promise<void> {
  const now = clock.now();
  for (const key of CMS_DOCUMENT_KEYS) {
    const document = await ensureDocument(db, key, now);
    const kind = kindOf(key);
    if (!kind) continue;
    const existing = await db.$count(
      cmsRevision,
      eq(cmsRevision.documentId, document.id)
    );
    if (existing > 0) continue;
    await db.insert(cmsRevision).values({
      id: uuidv7(now),
      documentId: document.id,
      version: 1,
      body: kind.seedBody(key),
      status: "published",
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
    });
  }
}
