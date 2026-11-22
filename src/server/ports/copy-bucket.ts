// The copy-bucket port: the few S3 verbs the nightly off-site copy (#68)
// needs on both sides. It lists and reads R2's production buckets, and it
// writes, reads and deletes copies in one Backblaze B2 bucket. It is not
// 63a's ObjectStorage: no presigned URLs, and listing plus streamed writes
// that only this copy needs.
// Adapters:
//   - S3 API (./copy-bucket-s3.ts): R2 and B2 both speak it.
//   - the in-memory fake (src/test/fakes/copy-bucket.ts): Seam 1 tests.
// Every adapter passes ./copy-bucket.contract.ts.
//
// Plain Node: no "server-only", no "@/env", so the worker can import it.

/** An object as a listing reports it. */
export type ListedObject = {
  key: string;
  /** Normalised (`normaliseEtag`, ./etag.ts): no quotes, lower case. */
  etag: string;
  sizeBytes: number;
  lastModified: Date;
};

/** An object's bytes and what was stored with them. */
export type ReadObject = {
  body: ReadableStream<Uint8Array>;
  sizeBytes: number;
  contentType: string | null;
  /** Normalised, like a listing's. */
  etag: string;
  /** User metadata, keys in lower case. */
  metadata: Record<string, string>;
};

export type WriteObject = {
  bucket: string;
  key: string;
  body: ReadableStream<Uint8Array>;
  /** The body's exact length; S3 needs it for a streamed PUT. */
  sizeBytes: number;
  contentType: string | null;
  /**
   * Base64 MD5 of the body (`contentMd5ForEtag`). The store refuses the
   * write with ContentDigestMismatchError if the bytes don't match.
   */
  contentMd5: string | null;
  /** User metadata; keys in lower case. */
  metadata: Record<string, string>;
};

export interface CopyBucket {
  /**
   * Every object under `prefix` (all of them without one), page after
   * page, in key order. Throws if any page fails, so a caller never takes
   * a partial listing for a complete one.
   */
  list(input: { bucket: string; prefix?: string }): AsyncIterable<ListedObject>;

  /** The object's bytes, streamed, or null if there is no object. */
  read(input: { bucket: string; key: string }): Promise<ReadObject | null>;

  /** Stores the object, replacing any at that key. */
  write(input: WriteObject): Promise<void>;

  /** Deletes the object. Deleting a missing object does nothing. */
  delete(input: { bucket: string; key: string }): Promise<void>;

  /** Whether there is an object at the key. */
  exists(input: { bucket: string; key: string }): Promise<boolean>;
}

/** The bytes a write sent don't match its Content-MD5 (S3's BadDigest). */
export class ContentDigestMismatchError extends Error {
  constructor({ bucket, key }: { bucket: string; key: string }) {
    super(`The bytes written to ${bucket}/${key} don't match their MD5`);
    this.name = "ContentDigestMismatchError";
  }
}
