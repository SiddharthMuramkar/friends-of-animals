import { randomUUID } from "node:crypto";
import { env } from "~/lib/env.server";
import { createBlobStorage } from "./blob.server";
import { createLocalStorage } from "./local.server";
import type { StorageDriver } from "./types";

export type { StorageDriver } from "./types";

/** Max accepted upload size for images (5 MB). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Allowed image MIME types -> canonical file extension. */
export const IMAGE_MIME_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
} as const;

export type AllowedImageMimeType = keyof typeof IMAGE_MIME_TYPES;

export function isAllowedImageType(
  mime: string | null | undefined,
): mime is AllowedImageMimeType {
  return !!mime && Object.hasOwn(IMAGE_MIME_TYPES, mime.toLowerCase());
}

/**
 * Build a collision-free key like `animals/<uuid>.jpg`. The extension comes
 * from `filename`, lowercased and stripped to [a-z0-9] (max 10 chars);
 * `jpeg` is normalized to `jpg`. Prefix is sanitized to safe path segments.
 */
export function makeUploadKey(prefix: string, filename: string): string {
  const safePrefix = prefix
    .split("/")
    .map((s) => s.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
    .filter(Boolean)
    .join("/");
  const dot = filename.lastIndexOf(".");
  let ext =
    dot >= 0
      ? filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10)
      : "";
  if (ext === "jpeg") ext = "jpg";
  const name = ext ? `${randomUUID()}.${ext}` : randomUUID();
  return safePrefix ? `${safePrefix}/${name}` : name;
}

let cached: StorageDriver | undefined;

/** Storage driver selected by STORAGE_DRIVER (cached). */
export function getStorage(): StorageDriver {
  if (cached) return cached;
  const config = env();
  cached =
    config.STORAGE_DRIVER === "blob"
      ? createBlobStorage(config.BLOB_READ_WRITE_TOKEN!)
      : createLocalStorage(config.UPLOAD_DIR);
  return cached;
}
