// The post editor's save (#112), as a plain function over the use cases so
// it is tested at Seam 1; the Server Actions in ./actions.ts only resolve
// the actor, refresh the tags and redirect. A Server Action can be called
// by anyone signed in, whatever the page showed, so the step asks whether
// the actor may write posts before it reads the body's markup: someone
// else's form is refused, never parsed. The use case authorises again.

import type { UseCases } from "@/server/app";

import {
  afterSave,
  postInputOf,
  readPostForm,
  type PostFormState,
} from "./post-form";

type PostWriter = Pick<
  UseCases,
  "checkPostWriter" | "createPost" | "updatePost"
>;

/** A save the use case took, or the form to show again. */
export type SaveOutcome =
  /** `tags`: the public cache tags to refresh. */
  | { ok: true; postId: string; tags: string[] }
  | { ok: false; state: PostFormState };

/**
 * Saves the form as a new draft, or as `postId`'s changes. Throws what the
 * use cases throw on purpose (forbidden, second factor) before reading it.
 */
export async function savePostStep(
  app: PostWriter,
  input: {
    postId?: string;
    formData: FormData;
    previous?: PostFormState | null;
  }
): Promise<SaveOutcome> {
  await app.checkPostWriter();
  const values = readPostForm(input.formData);
  const attempt = input.previous?.attempt ?? 0;
  const read = postInputOf(values);
  if (!read.ok) {
    return {
      ok: false,
      state: {
        attempt: attempt + 1,
        values,
        errors: {},
        sourceErrors: read.sourceErrors,
      },
    };
  }
  const { postId } = input;
  if (postId === undefined) {
    const result = await app.createPost(read.input);
    return result.ok
      ? { ok: true, postId: result.postId, tags: [] }
      : { ok: false, state: afterSave(result, values, attempt) };
  }
  const result = await app.updatePost({ postId, ...read.input });
  return result.ok
    ? { ok: true, postId, tags: result.tags }
    : { ok: false, state: afterSave(result, values, attempt) };
}
