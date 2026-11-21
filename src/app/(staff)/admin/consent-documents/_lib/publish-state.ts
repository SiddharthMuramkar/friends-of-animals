// What the publish form shows after Preview or a refused Publish. Pure, so
// the mapping is tested without a page; a published version redirects.

import type {
  ConsentDocumentBody,
  PreviewConsentDocumentResult,
  PublishConsentDocumentResult,
  SourceError,
} from "@/server/modules/consent";

export type PublishFormState = {
  /** What was typed, put back after the form resets. */
  title: string;
  source: string;
  /** The body the source would publish. */
  preview?: ConsentDocumentBody;
  /** What to fix in the source, by line. */
  sourceErrors?: SourceError[];
  titleError?: true;
  /** A problem for the whole form. */
  alert?: "failed";
};

type Entered = { title: string; source: string };

export function afterPreview(
  result: PreviewConsentDocumentResult,
  entered: Entered
): PublishFormState {
  return result.ok
    ? { ...entered, preview: result.body }
    : { ...entered, sourceErrors: result.errors };
}

export function afterPublishRefused(
  result: Exclude<PublishConsentDocumentResult, { ok: true }>,
  entered: Entered
): PublishFormState {
  if (result.error === "invalid_source") {
    return { ...entered, sourceErrors: result.errors };
  }
  if (result.fields.includes("title")) return { ...entered, titleError: true };
  // A purpose or a source too long: nothing the form can point at.
  return { ...entered, alert: "failed" };
}

/** The state plus its words, translated by the action on the server. */
export type PublishFormView = PublishFormState & {
  text: { alert?: string; title?: string; sourceErrors: string[] };
};
