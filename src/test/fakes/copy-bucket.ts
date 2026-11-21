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
    for (const key of keys) {
      const stored = objects.get(key);
      if (stored === undefined) continue;
      yield {
        key,
        etag: stored.etag,
        sizeBytes: stored.bytes.length,
        lastModified: new Date(stored.lastModified),
      };
    }
  }

  async read({
    bucket,
    key,
  }: {
    bucket: string;
    key: string;
  }): Promise<ReadObject | null> {
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
  }

  async delete({ bucket, key }: { bucket: string; key: string }) {
    this.#bucket(bucket).delete(key);
  }

  async exists({ bucket, key }: { bucket: string; key: string }) {
    return this.#bucket(bucket).has(key);
  }
}
