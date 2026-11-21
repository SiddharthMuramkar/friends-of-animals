// In-memory ObjectStorage for Seam 1 tests. Presigned URLs are real URLs
// with an HMAC signature, and `put`/`get` use them as a browser would: each
// checks the signature, the method, the signed headers and the expiry
// against the fake clock, so a test can watch a URL expire with
// `h.clock.advance()`. Passes src/server/ports/storage.contract.ts.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { Clock } from "@/server/ports/clock";
import {
  contentDispositionFor,
  isPurgeablePrefix,
  ObjectMissingError,
  UnsafePrefixError,
  type ObjectRef,
  type ObjectStorage,
  type StoredObject,
} from "@/server/ports/storage";

/** Why the fake storage refused a browser's request, as S3 would (403/404). */
export type FakeStorageRefusal =
  | "bad_signature"
  | "expired"
  | "wrong_method"
  | "header_mismatch"
  | "not_found";

export type FakePutResult =
  | { ok: true }
  | { ok: false; error: FakeStorageRefusal };

export type FakeGetResult =
  | {
      ok: true;
      bytes: Uint8Array;
      contentType: string | null;
      contentDisposition: string | null;
    }
  | { ok: false; error: FakeStorageRefusal };

type StoredBytes = { bytes: Uint8Array; contentType: string | null };

const ORIGIN = "https://storage.fake.test";

export class FakeStorage implements ObjectStorage {
  readonly #clock: Clock;
  /** By `<bucket>/<key>`. */
  readonly #objects = new Map<string, StoredBytes>();
  readonly #secret = randomBytes(32);

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async presignPut(input: {
    bucket: string;
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }) {
    const url = this.#sign(input, "PUT", input.expiresInSeconds, {
      "content-type": input.contentType,
      "content-length": String(input.contentLength),
    });
    return { url, headers: { "Content-Type": input.contentType } };
  }

  async presignGet(input: {
    bucket: string;
    key: string;
    expiresInSeconds: number;
    contentType: string;
    disposition: "inline" | "attachment";
    filename: string;
  }) {
    const url = this.#sign(input, "GET", input.expiresInSeconds, {
      "response-content-type": input.contentType,
      "response-content-disposition": contentDispositionFor(
        input.disposition,
        input.filename
      ),
    });
    return { url };
  }

  async head(ref: ObjectRef): Promise<StoredObject | null> {
    const object = this.#objects.get(id(ref));
    return object
      ? { sizeBytes: object.bytes.length, contentType: object.contentType }
      : null;
  }

  async read(ref: ObjectRef): Promise<ReadableStream<Uint8Array>> {
    const object = this.#objects.get(id(ref));
    if (!object) throw new ObjectMissingError(ref);
    return new Blob([object.bytes.slice()]).stream();
  }

  async write({
    body,
    contentType,
    ...ref
  }: ObjectRef & { body: Uint8Array; contentType: string }): Promise<void> {
    this.#objects.set(id(ref), { bytes: body.slice(), contentType });
  }

  async move({
    bucket,
    from,
    to,
  }: {
    bucket: string;
    from: string;
    to: string;
  }) {
    const object = this.#objects.get(id({ bucket, key: from }));
    if (!object) throw new ObjectMissingError({ bucket, key: from });
    this.#objects.set(id({ bucket, key: to }), object);
    this.#objects.delete(id({ bucket, key: from }));
  }

  async delete(ref: ObjectRef) {
    this.#objects.delete(id(ref));
  }

  async deletePrefix({ bucket, prefix }: { bucket: string; prefix: string }) {
    if (!isPurgeablePrefix(prefix)) throw new UnsafePrefixError(prefix);
    let deleted = 0;
    for (const key of this.keys(bucket)) {
      if (key.startsWith(prefix)) {
        this.#objects.delete(id({ bucket, key }));
        deleted += 1;
      }
    }
    return { deleted };
  }

  /** The browser's PUT of `bytes` with `headers` to a presigned URL. */
  async put(
    url: string,
    bytes: Uint8Array,
    headers: Record<string, string>
  ): Promise<FakePutResult> {
    const checked = this.#check(url, "PUT");
    if (!checked.ok) return checked;
    const { ref, params } = checked;
    if (
      header(headers, "content-type") !== params.get("content-type") ||
      String(bytes.length) !== params.get("content-length")
    ) {
      return { ok: false, error: "header_mismatch" };
    }
    this.#objects.set(id(ref), {
      bytes: bytes.slice(),
      contentType: params.get("content-type"),
    });
    return { ok: true };
  }

  /** The browser's GET of a presigned URL. */
  async get(url: string): Promise<FakeGetResult> {
    const checked = this.#check(url, "GET");
    if (!checked.ok) return checked;
    const { ref, params } = checked;
    const object = this.#objects.get(id(ref));
    if (!object) return { ok: false, error: "not_found" };
    return {
      ok: true,
      bytes: object.bytes.slice(),
      contentType: params.get("response-content-type") ?? object.contentType,
      contentDisposition: params.get("response-content-disposition"),
    };
  }

  /**
   * Stores an object directly, as if a client had got around the signed
   * headers: how a test sets up a stored object that doesn't match what was
   * declared.
   */
  plant(ref: ObjectRef & { bytes: Uint8Array; contentType: string | null }) {
    this.#objects.set(id(ref), {
      bytes: ref.bytes.slice(),
      contentType: ref.contentType,
    });
  }

  /** Every key in `bucket`, sorted. */
  keys(bucket: string): string[] {
    const start = `${bucket}/`;
    return [...this.#objects.keys()]
      .filter((each) => each.startsWith(start))
      .map((each) => each.slice(start.length))
      .sort();
  }

  #sign(
    { bucket, key }: ObjectRef,
    method: "PUT" | "GET",
    expiresInSeconds: number,
    signed: Record<string, string>
  ): string {
    const url = new URL(
      `${ORIGIN}/${encodeURIComponent(bucket)}/${encodeKey(key)}`
    );
    const expires = this.#clock.now().getTime() + expiresInSeconds * 1000;
    url.searchParams.set("method", method);
    url.searchParams.set("expires", String(expires));
    for (const [name, value] of Object.entries(signed)) {
      url.searchParams.set(name, value);
    }
    url.searchParams.sort();
    url.searchParams.set("signature", this.#signature(url));
    return url.href;
  }

  #signature(url: URL): string {
    const unsigned = new URL(url);
    unsigned.searchParams.delete("signature");
    unsigned.searchParams.sort();
    return createHmac("sha256", this.#secret)
      .update(`${unsigned.pathname}?${unsigned.searchParams}`)
      .digest("hex");
  }

  #check(
    href: string,
    method: "PUT" | "GET"
  ):
    | { ok: true; ref: ObjectRef; params: URLSearchParams }
    | { ok: false; error: FakeStorageRefusal } {
    const url = new URL(href);
    const given = Buffer.from(url.searchParams.get("signature") ?? "", "hex");
    const expected = Buffer.from(this.#signature(url), "hex");
    if (
      url.origin !== ORIGIN ||
      given.length !== expected.length ||
      !timingSafeEqual(given, expected)
    ) {
      return { ok: false, error: "bad_signature" };
    }
    if (url.searchParams.get("method") !== method) {
      return { ok: false, error: "wrong_method" };
    }
    if (this.#clock.now().getTime() > Number(url.searchParams.get("expires"))) {
      return { ok: false, error: "expired" };
    }
    const [bucket = "", ...key] = url.pathname
      .slice(1)
      .split("/")
      .map(decodeURIComponent);
    return {
      ok: true,
      ref: { bucket, key: key.join("/") },
      params: url.searchParams,
    };
  }
}

function id({ bucket, key }: ObjectRef): string {
  return `${bucket}/${key}`;
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** A request header by name, whatever its case. */
function header(
  headers: Record<string, string>,
  name: string
): string | undefined {
  return Object.entries(headers).find(
    ([each]) => each.toLowerCase() === name
  )?.[1];
}
