"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";

import {
  completeUploadStep,
  fileStatusStep,
  SIGNED_OUT,
  type FileStatusView,
  type RequestUploadView,
} from "@/app/account/files/_lib/upload-steps";
import { adminBlogPostPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError, errorSummaryForLogs } from "@/server/errors";
import { istLocalToInstant } from "@/server/modules/competitions/domain/ist";
import { StorageNotConfiguredError } from "@/server/ports/storage";

import {
  altRefusal,
  noticeQuery,
  type NoticeKind,
  type RefusalCode,
} from "./notices";
import { readPostForm, type PostFormState } from "./post-form";
import { savePostStep, type SaveOutcome } from "./save-steps";

// The post editor's Server Actions (#112). Each one checks who is asking,
// reads its form and calls one use case, which authorises again: a Server
// Action can be called directly, whatever the page showed. A save asks
// whether the actor may write posts before it parses the body
// (./save-steps.ts). A change that alters the public blog refreshes the
// tags its use case returns.

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function signedInActor() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

function back(postId: string, kind: NoticeKind, refused?: RefusalCode): never {
  redirect(`${adminBlogPostPath(postId)}?${noticeQuery(kind, refused)}`);
}

function failed(
  values: PostFormState["values"],
  attempt: number
): PostFormState {
  return {
    attempt: attempt + 1,
    values,
    errors: {},
    sourceErrors: [],
    alert: "failed",
  };
}

/**
 * Saves the form for the signed-in actor. Anything the step throws that
 * isn't on purpose is logged and shown as a save that failed.
 */
async function save(
  what: string,
  input: Parameters<typeof savePostStep>[1]
): Promise<SaveOutcome> {
  const actor = await signedInActor();
  try {
    return await savePostStep(as(actor), input);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    console.error(`Post editor: ${what} failed: ${errorSummaryForLogs(error)}`);
    const attempt = input.previous?.attempt ?? 0;
    return { ok: false, state: failed(readPostForm(input.formData), attempt) };
  }
}

/** Saves a new draft from the form, then opens its editor. */
export async function createPostAction(
  previous: PostFormState | null,
  formData: FormData
): Promise<PostFormState> {
  const saved = await save("creating", { formData, previous });
  if (!saved.ok) return saved.state;
  back(saved.postId, "created");
}

/** Saves the editor's changes; a live post's public pages refresh. */
export async function updatePostAction(
  postId: string,
  previous: PostFormState | null,
  formData: FormData
): Promise<PostFormState> {
  const saved = await save("saving", { postId, formData, previous });
  if (!saved.ok) return saved.state;
  for (const tag of saved.tags) updateTag(tag);
  back(postId, "saved");
}

type Moved = { ok: true; tags?: string[] } | { ok: false; error: string };

/** Runs one lifecycle use case and comes back to the editor, saying how it went. */
async function lifecycle(
  postId: string,
  kind: NoticeKind,
  run: () => Promise<Moved>
): Promise<never> {
  let result: Moved;
  try {
    result = await run();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    console.error(`Post editor: ${kind} failed: ${errorSummaryForLogs(error)}`);
    back(postId, kind, "failed");
  }
  if (!result.ok) back(postId, kind, result.error as RefusalCode);
  for (const tag of result.tags ?? []) updateTag(tag);
  back(postId, kind);
}

export async function schedulePostAction(formData: FormData) {
  const actor = await signedInActor();
  const postId = field(formData, "postId");
  const local = istLocalToInstant(field(formData, "publishAt"));
  if (!local.ok) back(postId, "scheduled", "invalid_instant");
  await lifecycle(postId, "scheduled", () =>
    as(actor).schedulePost({ postId, publishAt: local.at })
  );
}

export async function unschedulePostAction(formData: FormData) {
  const actor = await signedInActor();
  const postId = field(formData, "postId");
  await lifecycle(postId, "unscheduled", () =>
    as(actor).unschedulePost({ postId })
  );
}

export async function publishPostAction(formData: FormData) {
  const actor = await signedInActor();
  const postId = field(formData, "postId");
  await lifecycle(postId, "published", () => as(actor).publishPost({ postId }));
}

export async function archivePostAction(formData: FormData) {
  const actor = await signedInActor();
  const postId = field(formData, "postId");
  await lifecycle(postId, "archived", () => as(actor).archivePost({ postId }));
}

export async function restorePostAction(formData: FormData) {
  const actor = await signedInActor();
  const postId = field(formData, "postId");
  await lifecycle(postId, "restored", () => as(actor).restorePost({ postId }));
}

export async function describePostImageAction(formData: FormData) {
  const actor = await signedInActor();
  const postId = field(formData, "postId");
  await lifecycle(postId, "described", async () => {
    const result = await as(actor).describePostImage({
      postImageId: field(formData, "postImageId"),
      alt: field(formData, "alt"),
    });
    return result.ok ? result : { ok: false, error: altRefusal(result) };
  });
}

/**
 * Presigns an image upload for the post: the upload island's first step
 * (src/app/account/files/_lib/run-upload.ts). Never rejects for a reason
 * it can name, so the island keeps its form.
 */
export async function requestPostImageUploadAction(
  postId: string,
  input: { contentType: string; sizeBytes: number }
): Promise<RequestUploadView> {
  const actor = await currentActor();
  if (actor.kind !== "user") return SIGNED_OUT;
  try {
    const result = await as(actor).uploadPostImage({
      postId,
      contentType: String(input?.contentType ?? ""),
      sizeBytes: Number(input?.sizeBytes),
    });
    if (result.ok) {
      return {
        ok: true,
        fileId: result.fileId,
        uploadUrl: result.uploadUrl,
        headers: result.headers,
      };
    }
    const known = ["too_large", "empty", "type_not_allowed"] as const;
    const error = known.find((code) => code === result.error) ?? "unknown";
    return { ok: false, error };
  } catch (error) {
    if (error instanceof StorageNotConfiguredError) {
      return { ok: false, error: "storage_unavailable" };
    }
    if (error instanceof DomainError) return { ok: false, error: "unknown" };
    throw error;
  }
}

/** Confirms the PUT, which sends the image on to its scan. */
export async function completePostImageUploadAction(
  input: unknown
): Promise<FileStatusView> {
  const actor = await currentActor();
  if (actor.kind !== "user") return SIGNED_OUT;
  return completeUploadStep(as(actor), input);
}

/** Where the image's scan has got to. */
export async function postImageStatusAction(
  input: unknown
): Promise<FileStatusView> {
  const actor = await currentActor();
  if (actor.kind !== "user") return SIGNED_OUT;
  return fileStatusStep(as(actor), input);
}
