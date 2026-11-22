// A published version of an attachable document, cached for the public
// document page. Versions never change, but a version not published yet
// reads as null, so the entry carries the Consent module's tag: the
// publish action's `updateTag(consentDocumentTag(purpose))` (#64) clears
// it, and the "hours" profile bounds what an instance that missed it shows.
//
// Call it after `await connection()`, inside <Suspense>: the build has no
// database, so it must never run while prerendering.

import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import type { Actor } from "../../../actor";
import { as } from "../../../app";
import { consentDocumentTag } from "../../consent/tags";
import type { AttachablePurpose } from "../domain/consent-attachments";
import type { CompetitionDocumentVersion } from "./document-version";

/** A public read writes nothing and needs no address or user agent. */
const PUBLIC_READER: Actor = {
  kind: "visitor",
  meta: { ip: "", userAgent: "" },
};

export async function cachedCompetitionDocumentVersion(
  purpose: AttachablePurpose,
  version: number
): Promise<CompetitionDocumentVersion | null> {
  "use cache";
  cacheTag(consentDocumentTag(purpose));
  cacheLife("hours");
  return as(PUBLIC_READER).getCompetitionDocumentVersion({ purpose, version });
}
