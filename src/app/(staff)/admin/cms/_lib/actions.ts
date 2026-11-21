"use server";

import { getTranslations } from "next-intl/server";
import { updateTag } from "next/cache";
import { draftMode } from "next/headers";
import { redirect } from "next/navigation";

import { adminCmsDocumentPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import {
  isCmsDocumentKey,
  type CmsDocumentKey,
} from "@/server/modules/cms/domain/documents";
import { parseConsentDocumentSource } from "@/server/consent/domain/document-source";
import { DomainError, errorSummaryForLogs } from "@/server/errors";

import {
  afterSave,
  type EditorState,
  type EditorView,
  type RefusalReason,
} from "./editor-state";

// The CMS editor's Server Actions (#111). Each one checks who is asking,
// validates its form and calls one use case, which authorises again: a
// Server Action can be called directly, whatever the page showed.

async function withText(state: EditorState): Promise<EditorView> {
  const [t, sourceText] = await Promise.all([
    getTranslations("adminCms.editor.form"),
    // The markup is #64's, and so are its error messages.
    getTranslations("consentAdmin.form"),
  ]);
  return {
    ...state,
    text: {
      alert: state.alert ? t(state.alert) : undefined,
      sourceErrors: (state.sourceErrors ?? []).map(({ line, code }) =>
        line === null
          ? sourceText(`errors.${code}`)
          : sourceText("lineError", {
              line,
              message: sourceText(`errors.${code}`),
            })
      ),
    },
  };
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** A fresh value per redirect, so the same notice shows again. */
function token(): string {
  return Date.now().toString(36);
}

async function signedInActor() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

function editorPath(key: CmsDocumentKey, query: string): string {
  return `${adminCmsDocumentPath(key)}?${query}`;
}

/**
 * Saves a legal page's draft from the editor's markup. Line errors come
 * back to the form; a saved draft reloads the page, which shows it.
 */
export async function saveLegalDraftAction(
  _previous: EditorView | null,
  formData: FormData
): Promise<EditorView> {
  const actor = await signedInActor();
  const key = field(formData, "key");
  const source = field(formData, "source");
  if (!isCmsDocumentKey(key)) return withText({ source, alert: "failed" });
  const parsed = parseConsentDocumentSource(source);
  if (!parsed.ok) return withText(afterSave(parsed, source));
  try {
    const result = await as(actor).saveDraft({ key, body: parsed.body });
    if (!result.ok) return withText(afterSave(result, source));
  } catch (error) {
    console.error(`CMS editor: saving failed: ${errorSummaryForLogs(error)}`);
    return withText({ source, alert: "failed" });
  }
  redirect(editorPath(key, `saved=${token()}`));
}

/**
 * Publishes the draft, refreshes every cached read the publish changed
 * (the page, and the consent document it mirrors), and goes back to the
 * editor, which says so.
 */
export async function publishRevisionAction(formData: FormData) {
  const actor = await signedInActor();
  const key = field(formData, "key");
  if (!isCmsDocumentKey(key)) redirect(ROUTES.home.path);
  let outcome: { version: number; tags: string[] } | RefusalReason;
  try {
    const result = await as(actor).publishRevision({
      revisionId: field(formData, "revisionId"),
    });
    outcome = result.ok
      ? result
      : result.error === "invalid_input"
        ? "not_found"
        : result.error;
  } catch (error) {
    console.error(
      `CMS editor: publishing failed: ${errorSummaryForLogs(error)}`
    );
    outcome = "failed";
  }
  if (typeof outcome === "string") {
    redirect(editorPath(key, `refused=${outcome}`));
  }
  for (const tag of outcome.tags) updateTag(tag);
  redirect(editorPath(key, `published=${outcome.version}-${token()}`));
}

/**
 * Turns Draft Mode on for this browser and opens the document's public
 * page, which then shows the draft. startPreview authorises first: only a
 * content manager gets the cookie.
 */
export async function startPreviewAction(formData: FormData) {
  const actor = await signedInActor();
  const key = field(formData, "key");
  if (!isCmsDocumentKey(key)) redirect(ROUTES.home.path);
  let path: `/${string}`;
  try {
    const result = await as(actor).startPreview({ key });
    if (!result.ok) redirect(editorPath(key, "refused=failed"));
    path = result.path;
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    redirect(editorPath(key, "refused=failed"));
  }
  (await draftMode()).enable();
  redirect(path);
}
