import { del, put } from "@vercel/blob";
import type { StorageDriver } from "./types";

/**
 * Vercel Blob driver. The returned `key` is the full public blob URL
 * (https://<store>.public.blob.vercel-storage.com/...), so `url(key)` is the
 * identity and `delete(key)` can pass it straight to `del()`.
 */
export function createBlobStorage(token: string): StorageDriver {
  return {
    async put(pathname, data, opts) {
      const result = await put(pathname, data, {
        access: "public",
        addRandomSuffix: false,
        contentType: opts?.contentType,
        token,
      });
      return { key: result.url, url: result.url };
    },
    async delete(key) {
      await del(key, { token });
    },
    url(key) {
      if (key.startsWith("https://")) return key;
      throw new Error(
        `Blob storage key must be a full https:// URL, got ${JSON.stringify(key)}`,
      );
    },
  };
}
