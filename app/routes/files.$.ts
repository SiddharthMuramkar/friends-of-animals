import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { Route } from "./+types/files.$";
import { env } from "~/lib/env.server";
import { resolveSafePath } from "~/lib/storage/local.server";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
};

function notFound() {
  return new Response("Not Found", { status: 404 });
}

/** Serves files written by the local storage driver (dev / self-hosted only). */
export async function loader({ params }: Route.LoaderArgs) {
  const config = env();
  if (config.STORAGE_DRIVER !== "local") return notFound();

  let filePath: string;
  try {
    filePath = resolveSafePath(config.UPLOAD_DIR, params["*"] ?? "");
  } catch {
    return notFound();
  }

  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) return notFound();

  const contentType =
    MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream;

  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(info.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
