// The object storage port: private buckets the browser uploads to and
// downloads from through short-lived presigned URLs, so file bytes never
// pass through a Vercel function. It holds storage verbs only; what may be
// stored, under which key and who may read it are the Files module's rules
// (src/server/modules/files).
// Adapters:
//   - R2 (./storage-r2.ts), through the S3 API: any deployment with the R2_*
//     variables set. Moving to another S3-compatible store (S3 Mumbai) is a
//     change of endpoint and credentials.
//   - the in-memory fake (src/test/fakes/storage.ts): Seam 1 tests.
//   - disk (./storage-disk.ts): a local run without the R2_* variables, as
//     on a laptop and in CI's E2E job. Files on this machine, signed URLs
//     on the app's own /api/local-storage route.
//   - `unconfiguredStorage`: a deployment without storage config. It refuses
//     every call, so nothing pretends to store a file.
// Every adapter passes ./storage.contract.ts.

export type ObjectRef = { bucket: string; key: string };

/** What a stored object's HEAD says. */
export type StoredObject = {
  sizeBytes: number;
  /** The Content-Type it was stored with; null if it had none. */
  contentType: string | null;
};

export interface ObjectStorage {
  /**
   * A URL the browser PUTs one object to before `expiresInSeconds` pass.
   * The type and length are signed into it, so a PUT with another
   * Content-Type or another body length is refused. `headers` are the ones
   * the browser must send with the PUT (it sets Content-Length itself, from
   * the body).
   */
  presignPut(input: {
    bucket: string;
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; headers: Record<string, string> }>;

  /**
   * A URL that GETs the object before `expiresInSeconds` pass, served with
   * `contentType` and a Content-Disposition of `disposition` with
   * `filename`, whatever the object was stored with.
   */
  presignGet(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
    contentType: string;
    disposition: "inline" | "attachment";
    filename: string;
  }): Promise<{ url: string }>;

  /** The object's size and type, or null if there is no object. */
  head(input: ObjectRef): Promise<StoredObject | null>;

  /** The object's bytes, streamed. Rejects if there is no object. */
  read(input: ObjectRef): Promise<ReadableStream<Uint8Array>>;

  /**
   * Stores `body` at the key with `contentType`, replacing any object
   * there. For objects the server makes (#85's derivatives); a browser
   * uploads through `presignPut` instead.
   */
  write(
    input: ObjectRef & { body: Uint8Array; contentType: string }
  ): Promise<void>;

  /** Moves an object to another key in its bucket. Rejects if it is missing. */
  move(input: { bucket: string; from: string; to: string }): Promise<void>;

  /** Deletes an object. Deleting a missing object does nothing. */
  delete(input: ObjectRef): Promise<void>;

  /**
   * Deletes every object whose key starts with `prefix` and says how many
   * it deleted. Refuses a prefix `isPurgeablePrefix` rejects, such as "",
   * which would empty the bucket.
   */
  deletePrefix(input: {
    bucket: string;
    prefix: string;
  }): Promise<{ deleted: number }>;
}

/** One or more lower-case folders, each ending in "/": `pr-12/`. */
const PURGEABLE_PREFIX = /^(?:[a-z0-9_-]+\/)+$/;

/**
 * Whether `deletePrefix` may delete everything under `prefix`: a whole
 * folder, never "" (the bucket) or a part of a name ("pr-1" would take
 * pr-12/ with it).
 */
export function isPurgeablePrefix(prefix: string): boolean {
  return PURGEABLE_PREFIX.test(prefix);
}

/** Download names the platform generates: `test_upload-01938a00.png`. */
const DOWNLOAD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * The Content-Disposition a presigned GET asks for. The name is never
 * quoted or escaped, so anything that would need it is refused: it would
 * mean the name came from somewhere it shouldn't.
 */
export function contentDispositionFor(
  disposition: "inline" | "attachment",
  filename: string
): string {
  if (!DOWNLOAD_NAME.test(filename)) {
    throw new Error(`Not a download name: ${JSON.stringify(filename)}`);
  }
  return `${disposition}; filename="${filename}"`;
}

/** Thrown by `deletePrefix` for a prefix `isPurgeablePrefix` rejects. */
export class UnsafePrefixError extends Error {
  constructor(prefix: string) {
    super(
      `Refusing to delete under ${JSON.stringify(prefix)}: a prefix must ` +
        'be one or more folders ending in "/".'
    );
    this.name = "UnsafePrefixError";
  }
}

/** Thrown by `read` and `move` when there is no object at the key. */
export class ObjectMissingError extends Error {
  constructor({ bucket, key }: ObjectRef) {
    super(`No object at ${bucket}/${key}`);
    this.name = "ObjectMissingError";
  }
}

/** Thrown while a deployment has no object storage configured. */
export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "No object storage is configured. Set R2_ACCOUNT_ID, " +
        "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET (see " +
        ".env.example). Production waits for FOA's R2 buckets."
    );
    this.name = "StorageNotConfiguredError";
  }
}

const refuse = () => Promise.reject(new StorageNotConfiguredError());

/** A deployment's storage until R2 is configured: refuses every call. */
export const unconfiguredStorage: ObjectStorage = {
  presignPut: refuse,
  presignGet: refuse,
  head: refuse,
  read: refuse,
  write: refuse,
  move: refuse,
  delete: refuse,
  deletePrefix: refuse,
};
