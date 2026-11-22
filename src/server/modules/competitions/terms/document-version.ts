// Reading one published version of a document competitions attach (#72).
//
//   getCompetitionDocumentVersion({ purpose, version }) → anyone
//
// A competition pins a version, and the public terms link to it, so an
// older version stays readable after a newer one is published. Every
// published version is public text; only attachable purposes are served.
// Loads under plain Node: relative imports only.

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import type { ConsentDocumentBody } from "../../consent";
import { consentDocument } from "../../../db/schema";
import {
  ATTACHABLE_PURPOSES,
  type AttachablePurpose,
} from "../domain/consent-attachments";
import type { TermsContext } from "./fees";

export type CompetitionDocumentVersion = {
  id: string;
  purpose: AttachablePurpose;
  version: number;
  title: string;
  body: ConsentDocumentBody;
  publishedAt: Date;
};

const versionInput = z.object({
  purpose: z.string().max(64),
  version: z.int().positive().max(2_147_483_647),
});

/** The published version, or null if there is none or the purpose isn't attachable. */
export async function getCompetitionDocumentVersion(
  ctx: TermsContext,
  input: { purpose: string; version: number }
): Promise<CompetitionDocumentVersion | null> {
  await authorize(ctx, "competition.read_document");
  const { purpose, version } = versionInput.parse(input);
  const attachable = ATTACHABLE_PURPOSES.find((each) => each === purpose);
  if (attachable === undefined) return null;
  const [row] = await ctx.db
    .select({
      id: consentDocument.id,
      version: consentDocument.version,
      title: consentDocument.title,
      body: consentDocument.body,
      publishedAt: consentDocument.publishedAt,
    })
    .from(consentDocument)
    .where(
      and(
        eq(consentDocument.purpose, attachable),
        eq(consentDocument.version, version)
      )
    );
  return row ? { ...row, purpose: attachable } : null;
}
