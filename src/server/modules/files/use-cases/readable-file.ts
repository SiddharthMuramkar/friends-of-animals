// Finding the file a read names (#63), with the policy asked first. Staff
// who may read every file look it up by id. Anyone else may only find a
// file they uploaded, so a file they may not read and one that doesn't
// exist are refused alike (forbidden). A visitor or the platform is refused
// before any file is looked up.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq } from "drizzle-orm";

import { authorize, can } from "../../../access/can";
import { fileAsset, type FileAssetRow } from "../../../db/schema";
import { DomainError } from "../../../errors";
import type { FilesContext } from "./upload";

/**
 * The file `fileId` names, if the caller may read it; null only for staff
 * who may read every file, when there is no such file. Throws forbidden
 * for anyone else who can't read it, found or not.
 */
export async function findReadableFile(
  ctx: FilesContext,
  fileId: string
): Promise<FileAssetRow | null> {
  const everyFile = await can(ctx, "file.read");
  if (everyFile.allowed) {
    const [file] = await ctx.db
      .select()
      .from(fileAsset)
      .where(eq(fileAsset.id, fileId));
    return file ?? null;
  }
  // A user may read their own files; anyone else is refused here.
  const ownerId = ctx.actor.kind === "user" ? ctx.actor.userId : undefined;
  await authorize(ctx, "file.read", { ownerId });
  if (ownerId === undefined) throw new Error("unreachable");
  const [file] = await ctx.db
    .select()
    .from(fileAsset)
    .where(and(eq(fileAsset.id, fileId), eq(fileAsset.ownerUserId, ownerId)));
  if (!file) {
    throw new DomainError("forbidden", `${ctx.actor.kind} may not file.read`);
  }
  return file;
}
