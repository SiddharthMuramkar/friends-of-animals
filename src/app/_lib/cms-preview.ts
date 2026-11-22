"use server";

import { draftMode } from "next/headers";
import { redirect } from "next/navigation";

import { previewExitPath } from "./cms-preview-path";

/**
 * Leaves Draft Mode (#111) and goes back to the page that was being
 * previewed, which then shows what everyone sees. Anyone may leave: it
 * only clears their own cookie.
 */
export async function exitCmsPreviewAction(formData: FormData) {
  (await draftMode()).disable();
  const path = formData.get("path");
  redirect(previewExitPath(typeof path === "string" ? path : null));
}
