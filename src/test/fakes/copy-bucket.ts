// In-memory CopyBucket for Seam 1 tests of the off-site copy (#68): one
// instance stands for R2's production buckets, another for the B2 bucket.
// Passes src/server/ports/copy-bucket.contract.ts.

import { createHash } from "node:crypto";

import type { Clock } from "@/server/ports/clock";
import {
  ContentDigestMismatchError,
  type CopyBucket,
  type ListedObject,
  type ReadObject,
  type WriteObject,
} from "@/server/ports/copy-bucket";

type Stored = {
  bytes: Uint8Array;
  contentType: string | null;
  etag: string;
  metadata: Record<string, string>;
  lastModified: Date;
};

const realClock: Clock = { now: () => new Date() };

/** What a broken fake throws, as a network or provider failure would. */
export class FakeOutageError extends Error {
  constructor(what: string) {
    super(`Simulated outage: ${what}`);
    this.name = "FakeOutageError";
  }
}

type BreakableOperation = "read" | "write" | "delete";

function md5(bytes: Uint8Array, encoding: "hex" | "base64"): string {
  return createHash("md5").update(bytes).digest(encoding);
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (bytes.length > 0) controller.enqueue(bytes.slice());
      controller.close();
    },
  });
}

/** S3 lists keys in the order of their UTF-8 bytes. */
function byKeyBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

export class FakeCopyBucket implements CopyBucket {
  readonly #clock: Clock;
  readonly #buckets = new Map<string, Map<string, Stored>>();
  readonly #writes: { bucket: string; key: string }[] = [];
  /** `<operation> <bucket>/<key>` for each broken object. */
  readonly #brokenObjects = new Set<string>();
  /** Broken listings: how many objects each yields before it throws. */
  readonly #brokenListings = new Map<string, number>();

  constructor(options: { clock?: Clock } = {}) {
    this.#clock = options.clock ?? realClock;
  }

  #bucket(name: string): Map<string, Stored> {
    let bucket = this.#buckets.get(name);
    if (bucket === undefined) {
      bucket = new Map();
      this.#buckets.set(name, bucket);
    }
    return bucket;
  }

  async *list({
    bucket,
    prefix = "",
  }: {
    bucket: string;
    prefix?: string;
  }): AsyncIterable<ListedObject> {
    const objects = this.#bucket(bucket);
    const keys = [...objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort(byKeyBytes);
    const failAfter = this.#brokenListings.get(bucket);
    let yielded = 0;
    for (const key of keys) {
      if (yielded === failAfter) {
        throw new FakeOutageError(`listing ${bucket}`);
      }
      const stored = objects.get(key);
      if (stored === undefined) continue;
      yielded += 1;
      yield {
        key,
        etag: stored.etag,
        sizeBytes: stored.bytes.length,
        lastModified: new Date(stored.lastModified),
      };
    }
    if (yielded === failAfter) throw new FakeOutageError(`listing ${bucket}`);
  }

  async read({
    bucket,
    key,
  }: {
    bucket: string;
    key: string;
  }): Promise<ReadObject | null> {
    this.#throwIfBroken("read", { bucket, key });
    const stored = this.#bucket(bucket).get(key);
    if (stored === undefined) return null;
    return {
      body: streamOf(stored.bytes),
      sizeBytes: stored.bytes.length,
      contentType: stored.contentType,
      etag: stored.etag,
      metadata: { ...stored.metadata },
    };
  }

  async write(input: WriteObject): Promise<void> {
    this.#throwIfBroken("write", input);
    const bytes = new Uint8Array(await new Response(input.body).arrayBuffer());
    if (bytes.length !== input.sizeBytes) {
      throw new Error(
        `${input.bucket}/${input.key}: sent ${bytes.length} bytes, declared ${input.sizeBytes}`
      );
    }
    if (
      input.contentMd5 !== null &&
      input.contentMd5 !== md5(bytes, "base64")
    ) {
      throw new ContentDigestMismatchError(input);
    }
    this.#bucket(input.bucket).set(input.key, {
      bytes,
      contentType: input.contentType,
      etag: md5(bytes, "hex"),
      metadata: { ...input.metadata },
      lastModified: this.#clock.now(),
    });
    this.#writes.push({ bucket: input.bucket, key: input.key });
  }

  /** Every object stored so far, oldest first. */
  get writes(): readonly { bucket: string; key: string }[] {
    return this.#writes;
  }

  async delete({ bucket, key }: { bucket: string; key: string }) {
    this.#throwIfBroken("delete", { bucket, key });
    this.#bucket(bucket).delete(key);
  }

  async exists({ bucket, key }: { bucket: string; key: string }) {
    return this.#bucket(bucket).has(key);
  }

  /** Makes every later `operation` on this object throw, until `heal()`. */
  breakObject(
    operation: BreakableOperation,
    { bucket, key }: { bucket: string; key: string }
  ): void {
    this.#brokenObjects.add(`${operation} ${bucket}/${key}`);
  }

  /**
   * Makes every later listing of `bucket` throw after yielding
   * `afterObjects` objects (none by default), as a failed page would.
   */
  breakListing(bucket: string, { afterObjects = 0 } = {}): void {
    this.#brokenListings.set(bucket, afterObjects);
  }

  /** Ends every outage `breakObject` and `breakListing` started. */
  heal(): void {
    this.#brokenObjects.clear();
    this.#brokenListings.clear();
  }

  #throwIfBroken(
    operation: BreakableOperation,
    { bucket, key }: { bucket: string; key: string }
  ): void {
    if (this.#brokenObjects.has(`${operation} ${bucket}/${key}`)) {
      throw new FakeOutageError(`${operation} ${bucket}/${key}`);
    }
  }
}
