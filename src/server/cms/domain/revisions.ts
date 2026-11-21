// The life of a CMS revision (#111). A document has at most one open draft
// and at most one published revision. Content managers edit the draft in
// place; publishing gives it the next version number and supersedes the
// revision that was published, in one transaction. Published and superseded
// revisions never change again (the schema backs this with partial unique
// indexes and an update guard).
//
// Loads under plain Node (the schema's enum is built from the list below):
// no imports at all.

export const CMS_REVISION_STATUSES = [
  "draft",
  "published",
  "superseded",
] as const;

export type CmsRevisionStatus = (typeof CMS_REVISION_STATUSES)[number];

/** The only moves a revision makes; `null` is "does not exist yet". */
const MOVES: ReadonlySet<string> = new Set([
  "null>draft",
  "draft>published",
  "published>superseded",
]);

export function canMoveRevision(
  from: CmsRevisionStatus | null,
  to: CmsRevisionStatus
): boolean {
  return MOVES.has(`${from}>${to}`);
}

/** Only a draft's body may change. */
export function canEditRevision(status: CmsRevisionStatus): boolean {
  return status === "draft";
}

/** What the decisions need to know about a revision. */
export type RevisionRef = {
  id: string;
  status: CmsRevisionStatus;
  /** Set when the revision is published; null while it is a draft. */
  version: number | null;
};

export type SaveDraftDecision =
  | { action: "create" }
  | { action: "update"; revisionId: string };

/** Saving edits: update the document's open draft, or start one. */
export function decideSaveDraft(
  openDraft: RevisionRef | null
): SaveDraftDecision {
  if (!openDraft) return { action: "create" };
  if (!canEditRevision(openDraft.status)) {
    throw new Error(`Revision ${openDraft.id} is not a draft`);
  }
  return { action: "update", revisionId: openDraft.id };
}

export type PublishDecision =
  | { ok: true; version: number; supersede: string | null }
  | { ok: false; code: "not_draft" };

/**
 * Publishing `target`. Versions count published revisions: the next one is
 * one more than the highest the document has ever had, so a number is never
 * reused.
 */
export function decidePublish({
  target,
  published,
  maxVersion,
}: {
  target: RevisionRef;
  published: RevisionRef | null;
  maxVersion: number;
}): PublishDecision {
  if (!canMoveRevision(target.status, "published")) {
    return { ok: false, code: "not_draft" };
  }
  return {
    ok: true,
    version: maxVersion + 1,
    supersede: published?.id ?? null,
  };
}
