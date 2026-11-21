// Shared contract for every ObjectStorage adapter. The in-memory fake runs it
// in every `pnpm test`; the R2 adapter runs it against a real bucket with
// `pnpm test:live` (./storage-r2.live.test.ts). A fake that passes a check R2
// fails is wrong. Only imported by test files.

import { describe, expect, it } from "vitest";

import {
  ObjectMissingError,
  UnsafePrefixError,
  type ObjectStorage,
} from "./storage";

/** What a browser got back from a presigned GET. */
export type Download = {
  bytes: Uint8Array;
  contentType: string | null;
  contentDisposition: string | null;
};

export type StorageContractSetup = () => Promise<{
  storage: ObjectStorage;
  bucket: string;
  /** A folder of this run's own ("…/"), so runs on a real bucket never meet. */
  prefix: string;
  /** The browser's PUT to a presigned URL: true if the object was stored. */
  upload: (
    url: string,
    headers: Record<string, string>,
    bytes: Uint8Array
  ) => Promise<boolean>;
  /** The browser's GET of a presigned URL: null if it was refused. */
  download: (url: string) => Promise<Download | null>;
  /** Lets `seconds` pass: the fake moves its clock; a real bucket waits. */
  wait: (seconds: number) => Promise<void>;
}>;

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);

async function bytesOf(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function objectStorageContract(
  name: string,
  setup: StorageContractSetup
) {
  async function world() {
    const ctx = await setup();
    let keys = 0;
    /** A key of this run's own. */
    const keyFor = (folder = "files") => {
      keys += 1;
      return `${ctx.prefix}${folder}/object-${keys}`;
    };
    /** Stores `bytes` at `key` the way the browser does. */
    async function store(
      key: string,
      bytes: Uint8Array = PNG_BYTES,
      contentType = "image/png"
    ) {
      const { url, headers } = await ctx.storage.presignPut({
        bucket: ctx.bucket,
        key,
        contentType,
        contentLength: bytes.length,
        expiresInSeconds: 60,
      });
      expect(await ctx.upload(url, headers, bytes)).toBe(true);
    }
    const getUrl = async (key: string, expiresInSeconds = 60) =>
      (
        await ctx.storage.presignGet({
          bucket: ctx.bucket,
          key,
          expiresInSeconds,
          contentType: "image/png",
          disposition: "inline",
          filename: "test_upload-01938a00.png",
        })
      ).url;
    return { ...ctx, keyFor, store, getUrl };
  }

  describe(`${name} (ObjectStorage contract)`, () => {
    it("stores what the browser PUTs to a presigned URL", async () => {
      const { storage, bucket, upload, keyFor } = await world();
      const key = keyFor();
      expect(await storage.head({ bucket, key })).toBeNull();

      const { url, headers } = await storage.presignPut({
        bucket,
        key,
        contentType: "image/png",
        contentLength: PNG_BYTES.length,
        expiresInSeconds: 60,
      });
      expect(await upload(url, headers, PNG_BYTES)).toBe(true);

      expect(await storage.head({ bucket, key })).toEqual({
        sizeBytes: PNG_BYTES.length,
        contentType: "image/png",
      });
    });

    it("refuses a PUT with another type or length than it signed", async () => {
      const { storage, bucket, upload, keyFor } = await world();
      const key = keyFor();
      const { url, headers } = await storage.presignPut({
        bucket,
        key,
        contentType: "image/png",
        contentLength: PNG_BYTES.length,
        expiresInSeconds: 60,
      });

      const otherType = { ...headers, "Content-Type": "text/html" };
      expect(await upload(url, otherType, PNG_BYTES)).toBe(false);
      const longer = new Uint8Array([...PNG_BYTES, 6]);
      expect(await upload(url, headers, longer)).toBe(false);

      expect(await storage.head({ bucket, key })).toBeNull();
    });

    it("refuses a PUT once its URL has expired", async () => {
      const { storage, bucket, upload, wait, keyFor } = await world();
      const key = keyFor();
      const { url, headers } = await storage.presignPut({
        bucket,
        key,
        contentType: "image/png",
        contentLength: PNG_BYTES.length,
        expiresInSeconds: 1,
      });

      await wait(3);

      expect(await upload(url, headers, PNG_BYTES)).toBe(false);
      expect(await storage.head({ bucket, key })).toBeNull();
    });

    it("serves the object through a presigned GET, as it was asked to", async () => {
      const { storage, bucket, download, keyFor, store } = await world();
      const key = keyFor();
      // Stored as a JPEG; the GET asks for PNG.
      await store(key, PNG_BYTES, "image/jpeg");

      const { url } = await storage.presignGet({
        bucket,
        key,
        expiresInSeconds: 60,
        contentType: "image/png",
        disposition: "attachment",
        filename: "test_upload-01938a00.png",
      });

      expect(await download(url)).toEqual({
        bytes: PNG_BYTES,
        contentType: "image/png",
        contentDisposition: 'attachment; filename="test_upload-01938a00.png"',
      });
    });

    it("refuses a GET once its URL has expired", async () => {
      const { download, wait, keyFor, store, getUrl } = await world();
      const key = keyFor();
      await store(key);
      const url = await getUrl(key, 1);

      await wait(3);

      expect(await download(url)).toBeNull();
    });

    it("refuses a GET URL used to PUT, and a URL changed after signing", async () => {
      const { storage, bucket, upload, download, keyFor, store, getUrl } =
        await world();
      const key = keyFor();
      await store(key);
      const url = await getUrl(key);

      const replacement = new Uint8Array([9, 9, 9]);
      expect(
        await upload(url, { "Content-Type": "image/png" }, replacement)
      ).toBe(false);
      const other = keyFor();
      await store(other, replacement);
      expect(await download(url.replace(key, other))).toBeNull();

      expect(await storage.head({ bucket, key })).toEqual({
        sizeBytes: PNG_BYTES.length,
        contentType: "image/png",
      });
    });

    it("refuses a GET of an object that isn't there", async () => {
      const { download, keyFor, getUrl } = await world();

      expect(await download(await getUrl(keyFor()))).toBeNull();
    });

    it("streams an object's bytes, and rejects a missing one", async () => {
      const { storage, bucket, keyFor, store } = await world();
      const key = keyFor();
      await store(key);

      expect(await bytesOf(await storage.read({ bucket, key }))).toEqual(
        PNG_BYTES
      );
      await expect(storage.read({ bucket, key: keyFor() })).rejects.toThrow(
        ObjectMissingError
      );
    });

    it("moves an object to another key, and rejects a missing one", async () => {
      const { storage, bucket, keyFor, store } = await world();
      const from = keyFor();
      const to = keyFor("quarantine");
      await store(from);

      await storage.move({ bucket, from, to });

      expect(await storage.head({ bucket, key: from })).toBeNull();
      expect(await storage.head({ bucket, key: to })).toEqual({
        sizeBytes: PNG_BYTES.length,
        contentType: "image/png",
      });
      expect(await bytesOf(await storage.read({ bucket, key: to }))).toEqual(
        PNG_BYTES
      );
      await expect(
        storage.move({ bucket, from: keyFor(), to: keyFor() })
      ).rejects.toThrow(ObjectMissingError);
    });

    it("deletes an object, and does nothing for a missing one", async () => {
      const { storage, bucket, keyFor, store } = await world();
      const key = keyFor();
      await store(key);

      await storage.delete({ bucket, key });
      await storage.delete({ bucket, key });

      expect(await storage.head({ bucket, key })).toBeNull();
    });

    it("deletes everything under a prefix and nothing beside it", async () => {
      const { storage, bucket, prefix, store } = await world();
      const inside = [`${prefix}a/1`, `${prefix}a/b/2`];
      const beside = `${prefix}ab/3`;
      for (const key of [...inside, beside]) await store(key);

      expect(
        await storage.deletePrefix({ bucket, prefix: `${prefix}a/` })
      ).toEqual({ deleted: 2 });

      for (const key of inside) {
        expect(await storage.head({ bucket, key })).toBeNull();
      }
      expect(await storage.head({ bucket, key: beside })).not.toBeNull();
      await storage.deletePrefix({ bucket, prefix });
    });

    it("refuses to delete under a prefix that isn't a whole folder", async () => {
      const { storage, bucket, keyFor, store } = await world();
      const key = keyFor();
      await store(key);

      for (const prefix of ["", "files", "/files/", "../", "Files/"]) {
        await expect(storage.deletePrefix({ bucket, prefix })).rejects.toThrow(
          UnsafePrefixError
        );
      }
      expect(await storage.head({ bucket, key })).not.toBeNull();
    });
  });
}
