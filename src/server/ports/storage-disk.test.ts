import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeClock } from "@/test/fakes/clock";

import { objectStorageContract } from "./storage.contract";
import { diskStorage, type DiskStorage } from "./storage-disk";

const BASE_URL = "http://localhost:3000/api/local-storage/";
const SECRET = "a-local-signing-secret";
const BUCKET = "local";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function newRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "foa-disk-storage-test-"));
  roots.push(root);
  return root;
}

/** The browser's PUT: the body as a stream, Content-Length from it. */
function put(
  storage: DiskStorage,
  url: string,
  headers: Record<string, string>,
  bytes: Uint8Array
) {
  return storage.receive(
    url,
    new Headers({ ...headers, "Content-Length": String(bytes.length) }),
    new Blob([bytes.slice()]).stream()
  );
}

async function bytesOf(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

objectStorageContract("diskStorage", async () => {
  const clock = new FakeClock();
  const storage = diskStorage(
    { root: await newRoot(), baseUrl: BASE_URL, secret: SECRET },
    clock
  );
  return {
    storage,
    bucket: BUCKET,
    prefix: "contract/",
    upload: async (url, headers, bytes) =>
      (await put(storage, url, headers, bytes)).ok,
    download: async (url) => {
      const served = await storage.serve(url);
      if (!served.ok) return null;
      return {
        bytes: await bytesOf(served.body),
        contentType: served.contentType,
        contentDisposition: served.contentDisposition,
        cacheControl: served.cacheControl,
      };
    },
    wait: async (seconds) => {
      clock.advance({ seconds });
    },
  };
});

describe("diskStorage", () => {
  async function world(secret = SECRET) {
    const clock = new FakeClock();
    const root = await newRoot();
    const open = (withSecret = secret) =>
      diskStorage({ root, baseUrl: BASE_URL, secret: withSecret }, clock);
    return { clock, root, open, storage: open() };
  }

  const presign = (storage: DiskStorage, key = "local/test_upload/a") =>
    storage.presignPut({
      bucket: BUCKET,
      key,
      contentType: "image/png",
      contentLength: PNG.length,
      expiresInSeconds: 60,
    });

  it("signs URLs on the app's own base URL, so the browser stays on the site's origin", async () => {
    const { storage } = await world();

    const { url, headers } = await presign(storage);

    expect(url.startsWith(BASE_URL)).toBe(true);
    expect(headers).toEqual({ "Content-Type": "image/png" });
  });

  it("shares objects with another instance on the same folder and secret", async () => {
    const { open } = await world();
    const presigning = open();
    const receiving = open();

    const { url, headers } = await presign(presigning);

    expect(await put(receiving, url, headers, PNG)).toEqual({ ok: true });
    expect(
      await presigning.head({ bucket: BUCKET, key: "local/test_upload/a" })
    ).toEqual({ sizeBytes: PNG.length, contentType: "image/png" });
  });

  it("refuses a URL signed with another secret", async () => {
    const { open } = await world();
    const { url, headers } = await presign(open("another-secret"));

    expect(await put(open(), url, headers, PNG)).toEqual({
      ok: false,
      error: "bad_signature",
    });
  });

  it("refuses a PUT that doesn't say its length", async () => {
    const { storage } = await world();
    const { url, headers } = await presign(storage);

    const result = await storage.receive(
      url,
      new Headers(headers),
      new Blob([PNG.slice()]).stream()
    );

    expect(result).toEqual({ ok: false, error: "header_mismatch" });
  });

  it("refuses a body longer than the length it says, and stores nothing", async () => {
    const { storage } = await world();
    const { url, headers } = await presign(storage);

    const result = await storage.receive(
      url,
      new Headers({ ...headers, "Content-Length": String(PNG.length) }),
      new Blob([PNG.slice(), new Uint8Array([9])]).stream()
    );

    expect(result).toEqual({ ok: false, error: "header_mismatch" });
    expect(
      await storage.head({ bucket: BUCKET, key: "local/test_upload/a" })
    ).toBeNull();
  });

  it("refuses keys with empty, . or .. folders, and bucket names that aren't names", async () => {
    const { storage } = await world();

    for (const key of [
      "",
      ".",
      "..",
      "../x",
      "a/../../x",
      "a//b",
      "/a",
      "a/",
    ]) {
      await expect(presign(storage, key), key).rejects.toThrow(/storage key/);
      await expect(storage.head({ bucket: BUCKET, key }), key).rejects.toThrow(
        /storage key/
      );
    }
    for (const bucket of ["..", "../outside", "a/b", ""]) {
      await expect(storage.head({ bucket, key: "a" }), bucket).rejects.toThrow(
        /bucket/
      );
    }
  });

  it("keeps every object inside its folder", async () => {
    const base = await newRoot();
    const store = join("a", "b", "store");
    const storage = diskStorage(
      { root: join(base, store), baseUrl: BASE_URL, secret: SECRET },
      new FakeClock()
    );
    const key = "local/%2e%2e/%2e%2e/%2e%2e/escaped";
    const { url, headers } = await presign(storage, key);

    expect(await put(storage, url, headers, PNG)).toEqual({ ok: true });

    expect(await storage.head({ bucket: BUCKET, key })).not.toBeNull();
    const outside = (await readdir(base, { recursive: true })).filter(
      (entry) => !entry.startsWith(store) && entry.includes("escaped")
    );
    expect(outside).toEqual([]);
  });
});
