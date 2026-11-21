// Shared contract for every CopyBucket adapter. The in-memory fake runs it in
// every `pnpm test`; the S3 adapter runs it against a real R2 or B2 bucket
// only with OFFSITE_CONTRACT=1 (./copy-bucket-s3.live.test.ts). A fake that
// passes a check a real bucket fails is wrong. Only imported by test files.

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ContentDigestMismatchError,
  type CopyBucket,
  type ListedObject,
} from "./copy-bucket";

export type CopyBucketContractSetup = () => Promise<{
  store: CopyBucket;
  bucket: string;
  /** A folder of this run's own ("…/"), so runs on a real bucket never meet. */
  prefix: string;
}>;

/** A body for `write`. */
export function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (bytes.length > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
}

export async function bytesOf(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function md5(bytes: Uint8Array, encoding: "hex" | "base64"): string {
  return createHash("md5").update(bytes).digest(encoding);
}

const BYTES = new TextEncoder().encode("a copy worth keeping");

async function listAll(
  store: CopyBucket,
  input: { bucket: string; prefix?: string }
): Promise<ListedObject[]> {
  const listed: ListedObject[] = [];
  for await (const object of store.list(input)) listed.push(object);
  return listed;
}

export function copyBucketContract(
  name: string,
  setup: CopyBucketContractSetup
) {
  async function world() {
    const ctx = await setup();
    async function write(
      key: string,
      bytes: Uint8Array = BYTES,
      options: {
        contentType?: string | null;
        contentMd5?: string | null;
        metadata?: Record<string, string>;
      } = {}
    ) {
      await ctx.store.write({
        bucket: ctx.bucket,
        key,
        body: streamOf(bytes),
        sizeBytes: bytes.length,
        contentType: options.contentType ?? null,
        contentMd5: options.contentMd5 ?? null,
        metadata: options.metadata ?? {},
      });
    }
    return { ...ctx, write };
  }

  describe(`${name} (CopyBucket contract)`, () => {
    it("reads back the bytes, type and metadata it wrote, with the bytes' MD5 as etag", async () => {
      const { store, bucket, prefix, write } = await world();
      const key = `${prefix}files/one`;

      await write(key, BYTES, {
        contentType: "image/png",
        metadata: { "foa-source-etag": "abc123" },
      });

      const read = await store.read({ bucket, key });
      expect(read).toEqual({
        body: expect.any(ReadableStream),
        sizeBytes: BYTES.length,
        contentType: "image/png",
        etag: md5(BYTES, "hex"),
        metadata: { "foa-source-etag": "abc123" },
      });
      expect(await bytesOf(read!.body)).toEqual(BYTES);
    });

    it("lists what is under a prefix in key order, with etag, size and time", async () => {
      const { store, bucket, prefix, write } = await world();
      const short = new Uint8Array([1, 2]);
      await write(`${prefix}a/2`, BYTES);
      await write(`${prefix}a/1`, short);
      await write(`${prefix}b/1`, BYTES);

      const listed = await listAll(store, { bucket, prefix: `${prefix}a/` });

      expect(listed).toEqual([
        {
          key: `${prefix}a/1`,
          etag: md5(short, "hex"),
          sizeBytes: 2,
          lastModified: expect.any(Date),
        },
        {
          key: `${prefix}a/2`,
          etag: md5(BYTES, "hex"),
          sizeBytes: BYTES.length,
          lastModified: expect.any(Date),
        },
      ]);
      expect(Number.isNaN(listed[0]!.lastModified.getTime())).toBe(false);
    });

    it("lists nothing under a prefix that holds nothing", async () => {
      const { store, bucket, prefix } = await world();

      expect(
        await listAll(store, { bucket, prefix: `${prefix}none/` })
      ).toEqual([]);
    });

    it("replaces an object written again at the same key", async () => {
      const { store, bucket, prefix, write } = await world();
      const key = `${prefix}files/again`;
      const second = new Uint8Array([9, 9, 9]);
      await write(key, BYTES, { contentType: "image/png" });

      await write(key, second, { contentType: "application/pdf" });

      const read = await store.read({ bucket, key });
      expect(read).toMatchObject({
        sizeBytes: 3,
        contentType: "application/pdf",
        etag: md5(second, "hex"),
      });
      expect(await bytesOf(read!.body)).toEqual(second);
    });

    it("stores an object whose Content-MD5 matches its bytes", async () => {
      const { store, bucket, prefix, write } = await world();
      const key = `${prefix}files/checked`;

      await write(key, BYTES, { contentMd5: md5(BYTES, "base64") });

      expect(await store.exists({ bucket, key })).toBe(true);
    });

    it("refuses bytes that don't match their Content-MD5 and stores nothing", async () => {
      const { store, bucket, prefix, write } = await world();
      const key = `${prefix}files/damaged`;

      await expect(
        write(key, BYTES, { contentMd5: md5(new Uint8Array([0]), "base64") })
      ).rejects.toThrow(ContentDigestMismatchError);

      expect(await store.exists({ bucket, key })).toBe(false);
    });

    it("stores an empty object", async () => {
      const { store, bucket, prefix, write } = await world();
      const key = `${prefix}files/empty`;

      await write(key, new Uint8Array());

      const read = await store.read({ bucket, key });
      expect(read).toMatchObject({ sizeBytes: 0, contentType: null });
      expect(await bytesOf(read!.body)).toEqual(new Uint8Array());
    });

    it("reads null and says no object for a missing key", async () => {
      const { store, bucket, prefix } = await world();
      const key = `${prefix}files/missing`;

      expect(await store.read({ bucket, key })).toBeNull();
      expect(await store.exists({ bucket, key })).toBe(false);
    });

    it("deletes an object, and deleting a missing one does nothing", async () => {
      const { store, bucket, prefix, write } = await world();
      const key = `${prefix}gone/one`;
      await write(key);

      await store.delete({ bucket, key });
      await store.delete({ bucket, key });

      expect(await store.exists({ bucket, key })).toBe(false);
      expect(
        await listAll(store, { bucket, prefix: `${prefix}gone/` })
      ).toEqual([]);
    });
  });
}
