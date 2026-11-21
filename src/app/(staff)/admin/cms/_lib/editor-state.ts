// What the legal editor shows after Save, and which notice the page shows
// after a save, publish or refusal redirected back to it. Pure, so the
// mapping is tested without a page.

import type { SaveDraftResult } from "@/server/cms";
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
  _result:
    | { ok: false; errors: SourceError[] }
    | Exclude<SaveDraftResult, { ok: true }>,
  source: string
): EditorState {
  return { source };
}

export type RefusalReason = "not_draft" | "not_found" | "failed";

export type EditorNotice =
  | { kind: "saved"; key: string }
  | { kind: "published"; version: number; key: string }
  | { kind: "refused"; reason: RefusalReason };

type Params = Record<string, string | string[] | undefined>;

export function noticeOf(_params: Params): EditorNotice | null {
  return null;
}

/** The state plus its words, translated by the action on the server. */
export type EditorView = EditorState & {
  text: { alert?: string; sourceErrors: string[] };
};
