// Finding the file a read names (#63), with the policy asked first. Staff
// with broad Files access look it up by id. Anyone else may only find a
// file they uploaded, so an unreadable file and a missing one are both
// forbidden. A visitor or the platform is refused before any lookup.
// Entry images are read through the Entries module's own policy.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq } from "drizzle-orm";

import { authorize, can } from "../../../access/can";
import { fileAsset, type FileAssetRow } from "../../../db/schema";
import { DomainError } from "../../../errors";
import type { FilesContext } from "./upload";

/**
 * An uploaded file the caller may read through Files. Staff with broad
 * Files access get null for a missing file. Entry images are forbidden.
 */
export async function findReadableFile(
  ctx: FilesContext,
  fileId: string
): Promise<FileAssetRow | null> {
  const everyFile = await can(ctx, "file.read");
  const conditions = [eq(fileAsset.id, fileId)];
  if (!everyFile.allowed) {
    const ownerId = ctx.actor.kind === "user" ? ctx.actor.userId : undefined;
    await authorize(ctx, "file.read", { ownerId });
    if (ownerId === undefined) throw new Error("unreachable");
    conditions.push(eq(fileAsset.ownerUserId, ownerId));
  }
  const [file] = await ctx.db
    .select()
    .from(fileAsset)
    .where(and(...conditions));
  if (file?.purpose === "entry_image" || (!file && !everyFile.allowed)) {
    throw new DomainError("forbidden", `${ctx.actor.kind} may not file.read`);
  }
  return file ?? null;
}
