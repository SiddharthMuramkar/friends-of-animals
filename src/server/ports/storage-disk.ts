// The disk adapter for ObjectStorage: a local run's storage when R2 isn't
// configured (APP_ENV=local, src/server/deps.ts), on a laptop and in CI's
// E2E job. Objects are files on this machine. Presigned URLs point at the
// app itself, `<APP_URL>/api/local-storage/<bucket>/<key>`, whose route
// hands each request to `receive` or `serve` here. As with R2, a URL
// carries its method, its expiry and the headers it signs (type and length
// for a PUT), under an HMAC signature, so the Files module's rules hold on
// a local run too, and the browser's PUT stays on the site's own origin.
//
// Layout: `<root>/<bucket>/objects/<name>` holds an object's bytes and
// `<root>/<bucket>/types/<name>` the Content-Type it was stored with, where
// <name> is the whole key percent-encoded, so every object is one file in
// its bucket's folder and no key can reach outside it. A key's folders must
// be non-empty and not "." or "..", which URLs can't carry.
//
// Loads under plain Node: no "server-only", no Next imports.

import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type { Clock } from "./clock";
import {
  contentDispositionFor,
  FILE_CACHE_CONTROL,
  isPurgeablePrefix,
  ObjectMissingError,
  UnsafePrefixError,
  type ObjectRef,
  type ObjectStorage,
  type StoredObject,
} from "./storage";

export type DiskStorageConfig = {
  /** The folder the objects are kept in; made on the first upload. */
  root: string;
  /** Where the app serves this store: `<APP_URL>/api/local-storage/`. */
  baseUrl: string;
  /** Signs the presigned URLs. */
  secret: string;
};

/** Why the store refused a browser's request, as S3 would (403/404). */
export type DiskRefusal =
  | "bad_signature"
  | "expired"
  | "wrong_method"
  | "header_mismatch"
  | "not_found";

export type DiskReceipt = { ok: true } | { ok: false; error: DiskRefusal };

export type DiskDelivery =
  | {
      ok: true;
      body: ReadableStream<Uint8Array>;
      sizeBytes: number;
      contentType: string | null;
      contentDisposition: string | null;
      cacheControl: string | null;
    }
  | { ok: false; error: DiskRefusal };

export interface DiskStorage extends ObjectStorage {
  /**
   * The browser's PUT of `body` to a presigned URL. It is stored only if
   * the URL is valid for a PUT and the request's Content-Type and
   * Content-Length, and the body's length, are the signed ones.
   */
  receive(
    url: string,
    headers: Headers,
    body: ReadableStream<Uint8Array> | null
  ): Promise<DiskReceipt>;

  /** The browser's GET of a presigned URL. */
  serve(url: string): Promise<DiskDelivery>;
}

// Every path here is worked out at runtime, so each file system call
// carries `turbopackIgnore`: otherwise the build's file tracing can't scope
// the path and copies the whole project into every server bundle that
// imports this (through src/server/deps.ts).

/** Uploads may hold personal data, even locally: readable by their owner only. */
const PRIVATE_FOLDER = { recursive: true, mode: 0o700 } as const;
const PRIVATE_FILE = { mode: 0o600 } as const;

/** An R2 bucket name (src/env.schema.ts), which is also a safe folder name. */
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
/** The longest file name most file systems allow. */
const MAX_NAME_LENGTH = 255;

type Located = { folder: string; object: string; type: string };

function bucketFolder(root: string, bucket: string): string {
  if (!BUCKET.test(bucket)) {
    throw new Error(`Not a bucket name: ${JSON.stringify(bucket)}`);
  }
  return join(root, bucket);
}

function locate(root: string, { bucket, key }: ObjectRef): Located {
  const folder = bucketFolder(root, bucket);
  const folders = key.split("/");
  const name = encodeURIComponent(key);
  if (
    folders.some((each) => each === "" || each === "." || each === "..") ||
    name.length > MAX_NAME_LENGTH
  ) {
    throw new Error(`Not a storage key: ${JSON.stringify(key)}`);
  }
  return {
    folder,
    object: join(folder, "objects", name),
    type: join(folder, "types", name),
  };
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

/** What the signature covers: the object and every other parameter. */
function canonical({ bucket, key }: ObjectRef, params: URLSearchParams) {
  const signed = new URLSearchParams(params);
  signed.delete("signature");
  signed.sort();
  return ["foa-local-storage", bucket, key, signed.toString()].join("\n");
}

/**
 * Reads `body` if it is exactly `length` bytes long; null otherwise. Stops
 * reading as soon as it is longer.
 */
async function readExactly(
  body: ReadableStream<Uint8Array> | null,
  length: number
): Promise<Uint8Array | null> {
  if (!body) return length === 0 ? new Uint8Array() : null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > length) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return total === length ? Buffer.concat(chunks) : null;
}

/** A file's bytes as a stream, read in pieces; closes the file at the end. */
async function streamFile(path: string): Promise<ReadableStream<Uint8Array>> {
  const handle = await open(/* turbopackIgnore: true */ path, "r");
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const buffer = new Uint8Array(64 * 1024);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length);
        if (bytesRead === 0) {
          await handle.close();
          controller.close();
          return;
        }
        controller.enqueue(buffer.subarray(0, bytesRead));
      } catch (error) {
        await handle.close();
        throw error;
      }
    },
    async cancel() {
      await handle.close();
    },
  });
}

/** The signing key's file in a store's root. */
const SIGNING_KEY_FILE = ".signing-key";
const SIGNING_KEY = /^[0-9a-f]{64}$/;
const signingKeys = new Map<string, string>();

/**
 * The key a store at `root` signs its URLs with: random, made on first use
 * and kept in `root` (0600, in a 0700 folder), so every handler of this
 * installation shares it, no other installation or user has it, and nobody
 * can sign a URL for it from a key in the source.
 */
export function signingKeyFor(root: string): string {
  const known = signingKeys.get(root);
  if (known) return known;
  mkdirSync(/* turbopackIgnore: true */ root, PRIVATE_FOLDER);
  const folder = statSync(/* turbopackIgnore: true */ root);
  if (typeof process.getuid === "function" && folder.uid !== process.getuid()) {
    throw new Error(`The local storage folder ${root} belongs to another user`);
  }
  // Folders made before the key existed may be wider.
  if ((folder.mode & 0o077) !== 0)
    chmodSync(/* turbopackIgnore: true */ root, 0o700);
  const path = join(root, SIGNING_KEY_FILE);
  try {
    writeFileSync(
      /* turbopackIgnore: true */ path,
      randomBytes(32).toString("hex"),
      {
        ...PRIVATE_FILE,
        flag: "wx",
      }
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const key = readFileSync(/* turbopackIgnore: true */ path, "utf8");
  if (!SIGNING_KEY.test(key)) {
    throw new Error(`${path} isn't a signing key; delete it to make a new one`);
  }
  signingKeys.set(root, key);
  return key;
}

export function diskStorage(
  { root, baseUrl, secret }: DiskStorageConfig,
  clock: Clock
): DiskStorage {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

  const signatureOf = (ref: ObjectRef, params: URLSearchParams) =>
    createHmac("sha256", secret).update(canonical(ref, params)).digest("hex");

  function presign(
    ref: ObjectRef,
    method: "PUT" | "GET",
    expiresInSeconds: number,
    signed: Record<string, string>
  ): string {
    locate(root, ref);
    const path = [ref.bucket, ...ref.key.split("/")]
      .map(encodeURIComponent)
      .join("/");
    const url = new URL(path, base);
    const expires = clock.now().getTime() + expiresInSeconds * 1000;
    url.searchParams.set("method", method);
    url.searchParams.set("expires", String(expires));
    for (const [name, value] of Object.entries(signed)) {
      url.searchParams.set(name, value);
    }
    url.searchParams.sort();
    url.searchParams.set("signature", signatureOf(ref, url.searchParams));
    return url.href;
  }

  /** The object a presigned URL names, if the URL is valid for `method`. */
  function check(
    href: string,
    method: "PUT" | "GET"
  ):
    | { ok: true; ref: ObjectRef; params: URLSearchParams }
    | { ok: false; error: DiskRefusal } {
    let ref: ObjectRef;
    let params: URLSearchParams;
    try {
      const url = new URL(href);
      if (!url.pathname.startsWith(base.pathname)) throw new Error("elsewhere");
      const [bucket = "", ...key] = url.pathname
        .slice(base.pathname.length)
        .split("/")
        .map(decodeURIComponent);
      ref = { bucket, key: key.join("/") };
      locate(root, ref);
      params = url.searchParams;
    } catch {
      return { ok: false, error: "bad_signature" };
    }
    const given = Buffer.from(params.get("signature") ?? "", "hex");
    const expected = Buffer.from(signatureOf(ref, params), "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return { ok: false, error: "bad_signature" };
    }
    if (params.get("method") !== method) {
      return { ok: false, error: "wrong_method" };
    }
    const expires = Number(params.get("expires"));
    if (!Number.isFinite(expires) || clock.now().getTime() > expires) {
      return { ok: false, error: "expired" };
    }
    return { ok: true, ref, params };
  }

  async function head(ref: ObjectRef): Promise<StoredObject | null> {
    const { object, type } = locate(root, ref);
    let sizeBytes: number;
    try {
      sizeBytes = (await stat(/* turbopackIgnore: true */ object)).size;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    const contentType = await readFile(
      /* turbopackIgnore: true */ type,
      "utf8"
    ).catch((error) => {
      if (isMissing(error)) return "";
      throw error;
    });
    return { sizeBytes, contentType: contentType || null };
  }

  async function read(ref: ObjectRef): Promise<ReadableStream<Uint8Array>> {
    try {
      return await streamFile(locate(root, ref).object);
    } catch (error) {
      if (isMissing(error)) throw new ObjectMissingError(ref);
      throw error;
    }
  }

  /** Stores `bytes` at `ref` with `contentType`, replacing any object. */
  async function store(
    ref: ObjectRef,
    bytes: Uint8Array,
    contentType: string
  ): Promise<void> {
    const { folder, object, type } = locate(root, ref);
    await mkdir(
      /* turbopackIgnore: true */ join(folder, "objects"),
      PRIVATE_FOLDER
    );
    await mkdir(
      /* turbopackIgnore: true */ join(folder, "types"),
      PRIVATE_FOLDER
    );
    // Written beside the objects, then renamed in, so a reader never sees
    // half an object.
    const partial = join(folder, `.partial-${randomUUID()}`);
    await writeFile(/* turbopackIgnore: true */ partial, bytes, PRIVATE_FILE);
    await writeFile(
      /* turbopackIgnore: true */ type,
      contentType,
      PRIVATE_FILE
    );
    await rename(/* turbopackIgnore: true */ partial, object);
  }

  async function remove(ref: ObjectRef): Promise<void> {
    const { object, type } = locate(root, ref);
    await rm(/* turbopackIgnore: true */ object, { force: true });
    await rm(/* turbopackIgnore: true */ type, { force: true });
  }

  return {
    async presignPut(input) {
      const url = presign(input, "PUT", input.expiresInSeconds, {
        "content-type": input.contentType,
        "content-length": String(input.contentLength),
      });
      return { url, headers: { "Content-Type": input.contentType } };
    },

    async presignGet(input) {
      const url = presign(input, "GET", input.expiresInSeconds, {
        "response-content-type": input.contentType,
        "response-content-disposition": contentDispositionFor(
          input.disposition,
          input.filename
        ),
        "response-cache-control": FILE_CACHE_CONTROL,
      });
      return { url };
    },

    head,
    read,

    async write({ bucket, key, body, contentType }) {
      await store({ bucket, key }, body, contentType);
    },

    async move({ bucket, from, to }) {
      const source = locate(root, { bucket, key: from });
      const target = locate(root, { bucket, key: to });
      try {
        await rename(/* turbopackIgnore: true */ source.object, target.object);
      } catch (error) {
        if (isMissing(error))
          throw new ObjectMissingError({ bucket, key: from });
        throw error;
      }
      await rename(/* turbopackIgnore: true */ source.type, target.type).catch(
        (error) => {
          if (!isMissing(error)) throw error;
        }
      );
    },

    delete: remove,

    async deletePrefix({ bucket, prefix }) {
      if (!isPurgeablePrefix(prefix)) throw new UnsafePrefixError(prefix);
      let names: string[];
      try {
        names = await readdir(
          /* turbopackIgnore: true */ join(
            bucketFolder(root, bucket),
            "objects"
          )
        );
      } catch (error) {
        if (isMissing(error)) return { deleted: 0 };
        throw error;
      }
      let deleted = 0;
      for (const key of names.map(decodeURIComponent)) {
        if (!key.startsWith(prefix)) continue;
        await remove({ bucket, key });
        deleted += 1;
      }
      return { deleted };
    },

    async receive(url, headers, body) {
      const checked = check(url, "PUT");
      if (!checked.ok) {
        await body?.cancel();
        return checked;
      }
      const contentType = checked.params.get("content-type");
      const length = checked.params.get("content-length");
      if (
        headers.get("content-type") !== contentType ||
        headers.get("content-length") !== length
      ) {
        await body?.cancel();
        return { ok: false, error: "header_mismatch" };
      }
      const bytes = await readExactly(body, Number(length));
      if (!bytes) return { ok: false, error: "header_mismatch" };

      await store(checked.ref, bytes, contentType ?? "");
      return { ok: true };
    },

    async serve(url) {
      const checked = check(url, "GET");
      if (!checked.ok) return checked;
      const { ref, params } = checked;
      const stored = await head(ref);
      if (!stored) return { ok: false, error: "not_found" };
      let body: ReadableStream<Uint8Array>;
      try {
        body = await read(ref);
      } catch (error) {
        if (error instanceof ObjectMissingError) {
          return { ok: false, error: "not_found" };
        }
        throw error;
      }
      return {
        ok: true,
        body,
        sizeBytes: stored.sizeBytes,
        contentType: params.get("response-content-type") ?? stored.contentType,
        contentDisposition: params.get("response-content-disposition"),
        cacheControl: params.get("response-cache-control"),
      };
    },
  };
}
