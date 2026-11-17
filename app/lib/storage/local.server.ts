import { mkdir, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { StorageDriver } from "./types";

/**
 * Resolve `key` inside `rootDir`, rejecting absolute paths, `..` segments,
 * backslashes and NUL bytes. Returns the absolute file path.
 */
export function resolveSafePath(rootDir: string, key: string): string {
  if (
    !key ||
    key.includes("\0") ||
    key.includes("\\") ||
    path.isAbsolute(key) ||
    key.split("/").some((seg) => seg === ".." || seg === "." || seg === "")
  ) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
  }
  const root = path.resolve(rootDir);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
  }
  return full;
}

export function createLocalStorage(uploadDir: string): StorageDriver {
  return {
    async put(key, data) {
      const filePath = resolveSafePath(uploadDir, key);
      await mkdir(path.dirname(filePath), { recursive: true });
      if (Buffer.isBuffer(data)) {
        await writeFile(filePath, data);
      } else if (data instanceof Blob) {
        await writeFile(filePath, Buffer.from(await data.arrayBuffer()));
      } else {
        await pipeline(
          Readable.fromWeb(data as WebReadableStream),
          createWriteStream(filePath),
        );
      }
      return { key, url: this.url(key) };
    },
    async delete(key) {
      await rm(resolveSafePath(uploadDir, key), { force: true });
    },
    url(key) {
      return `/files/${key}`;
    },
  };
}
