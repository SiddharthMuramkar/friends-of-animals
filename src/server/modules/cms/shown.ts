// What a public CMS-backed page shows (#111): the published revision,
// cached; or, in Draft Mode, the open draft for someone allowed to
// preview it. The actor is read from the session on every draft request,
// so a content manager whose role was revoked stops previewing at once.
//
// Call it after `await connection()`, inside <Suspense>: it reads the
// request (Draft Mode, the session) and the database, which the build
// has neither of. A failed read gives null, so the page keeps the repo's
// copy: a policy page must always be readable.

import "server-only";

import { draftMode } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { as, currentActor } from "../../app";
import { DomainError, errorSummaryForLogs } from "../../errors";
import { loadPublishedDocument } from "./cached";
import type { CmsDocumentKey } from "./domain/documents";

export type ShownCmsDocument = {
  /** Whether Draft Mode is on, so the page shows the preview status. */
  previewing: boolean;
  /**
   * The text to show, sanitised by its kind (the page types it with the
   * kind); null in Draft Mode when there is nothing to show but the
   * repo's copy.
   */
  body: unknown;
  /** The published version shown, or null when the draft is. */
  published: { version: number; publishedAt: Date } | null;
};

/** The open draft, if Draft Mode is on and the actor may preview it. */
async function previewDraft(key: CmsDocumentKey) {
  const actor = await currentActor();
  try {
    return await as(actor).getDraftForPreview({ key });
  } catch (error) {
    // Not (or no longer) a content manager, or no second factor in this
    // session: they see what everyone sees.
    if (error instanceof DomainError) return null;
    throw error;
  }
}

/**
 * What `key`'s page shows now, or null to keep the repo's copy (nothing
 * published and no draft to preview, or the database failed).
 */
export async function loadShownDocument(
  key: CmsDocumentKey
): Promise<ShownCmsDocument | null> {
  try {
    const { isEnabled: previewing } = await draftMode();
    const draft = previewing ? await previewDraft(key) : null;
    if (draft) return { previewing, body: draft.body, published: null };
    const document = await loadPublishedDocument(key);
    if (!document)
      return previewing ? { previewing, body: null, published: null } : null;
    return {
      previewing,
      body: document.body,
      published: {
        version: document.version,
        publishedAt: document.publishedAt,
      },
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      `CMS page: could not read ${key}: ${errorSummaryForLogs(error)}`
    );
    return null;
  }
}
