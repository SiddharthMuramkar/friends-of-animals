/**
 * Storage contract: callers persist the returned `key` (e.g. in the DB) and
 * later call `storage.url(key)` to get a browser-usable URL. Keys are opaque:
 * for the local driver they are relative paths (`animals/<uuid>.jpg`), for the
 * blob driver they are the full public blob URL.
 */
export interface StorageDriver {
  put(
    key: string,
    data: Blob | Buffer | ReadableStream,
    opts?: { contentType?: string },
  ): Promise<{ key: string; url: string }>;
  delete(key: string): Promise<void>;
  url(key: string): string;
}
