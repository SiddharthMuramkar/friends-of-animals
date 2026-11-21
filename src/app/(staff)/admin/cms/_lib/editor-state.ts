// What the legal editor shows after Save, and which notice the page shows
// after a save, publish or refusal redirected back to it. Pure, so the
// mapping is tested without a page.

import type { SaveDraftResult } from "@/server/modules/cms";
import type { SourceError } from "@/server/consent";

export type EditorState = {
  /** What was typed, put back after the form resets. */
  source: string;
  /** What to fix in the source, by line. */
  sourceErrors?: SourceError[];
  /** A problem for the whole form. */
  alert?: "invalidBody" | "failed";
};

/** The editor's answer to a Save that didn't save. */
export function afterSave(
  result:
    | { ok: false; errors: SourceError[] }
    | Exclude<SaveDraftResult, { ok: true }>,
  source: string
): EditorState {
  if ("errors" in result) return { source, sourceErrors: result.errors };
  if (result.error === "invalid_body") return { source, alert: "invalidBody" };
  // A document that doesn't exist or has no editor: nothing to point at.
  return { source, alert: "failed" };
}

export type RefusalReason = "not_draft" | "not_found" | "failed";

export type EditorNotice =
  | { kind: "saved"; key: string }
  | { kind: "published"; version: number; key: string }
  | { kind: "refused"; reason: RefusalReason };

type Params = Record<string, string | string[] | undefined>;

const REFUSAL_REASONS: readonly RefusalReason[] = [
  "not_draft",
  "not_found",
  "failed",
];

/**
 * The notice from the action's redirect: `?saved=<token>`,
 * `?published=<version>-<token>` or `?refused=<reason>`. The token makes
 * each redirect a new URL, so saving twice shows the notice twice.
 */
export function noticeOf(params: Params): EditorNotice | null {
  const { saved, published, refused } = params;
  if (typeof saved === "string" && saved) return { kind: "saved", key: saved };
  if (typeof published === "string") {
    const match = /^(\d+)-[a-z0-9]+$/.exec(published);
    if (match) {
      return { kind: "published", version: Number(match[1]), key: published };
    }
  }
  const reason = REFUSAL_REASONS.find((each) => each === refused);
  return reason ? { kind: "refused", reason } : null;
}

/** The state plus its words, translated by the action on the server. */
export type EditorView = EditorState & {
  text: { alert?: string; sourceErrors: string[] };
};
