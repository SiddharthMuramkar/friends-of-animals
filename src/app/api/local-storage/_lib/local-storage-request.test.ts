import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { diskStorage, type DiskStorage } from "@/server/ports/storage-disk";
import { FakeClock } from "@/test/fakes/clock";

import { downloadRequest, uploadRequest } from "./local-storage-request";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const REF = { bucket: "local", key: "local/test_upload/a" };

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function store(): Promise<DiskStorage> {
  const root = await mkdtemp(join(tmpdir(), "foa-local-storage-request-"));
  roots.push(root);
  return diskStorage(
    {
      root,
      baseUrl: "http://localhost:3000/api/local-storage/",
      secret: "a-local-signing-secret",
    },
    new FakeClock()
  );
}

/** The browser's PUT, which says the body's length itself. */
function putRequest(url: string, contentType: string, bytes = PNG) {
  return new Request(url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.length),
    },
    body: bytes.slice(),
  });
}

async function presignPut(storage: DiskStorage) {
  const { url } = await storage.presignPut({
    ...REF,
    contentType: "image/png",
    contentLength: PNG.length,
    expiresInSeconds: 60,
  });
  return url;
}

async function presignGet(storage: DiskStorage) {
  const { url } = await storage.presignGet({
    ...REF,
    expiresInSeconds: 60,
    contentType: "image/png",
    disposition: "inline",
    filename: "test_upload-01938a00.png",
  });
  return url;
}

describe("the local storage route", () => {
  it("answers 404 where there is no disk store: every deployment, and a local run with R2", async () => {
    const url = "http://localhost:3000/api/local-storage/local/a?signature=0";

    const upload = await uploadRequest(null, putRequest(url, "image/png"));
    const download = await downloadRequest(null, new Request(url));

    expect([upload.status, download.status]).toEqual([404, 404]);
  });

  it("stores the browser's PUT to a signed URL, and serves it back to a signed GET", async () => {
    const storage = await store();

    const upload = await uploadRequest(
      storage,
      putRequest(await presignPut(storage), "image/png")
    );
    const download = await downloadRequest(
      storage,
      new Request(await presignGet(storage))
    );

    expect(upload.status).toBe(200);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PNG);
    expect(Object.fromEntries(download.headers)).toMatchObject({
      "content-type": "image/png",
      "content-disposition": 'inline; filename="test_upload-01938a00.png"',
      "content-length": String(PNG.length),
      "cache-control": "private, no-store",
    });
  });

  it("refuses a PUT that breaks its signature (403), and a GET of nothing stored (404)", async () => {
    const storage = await store();

    const upload = await uploadRequest(
      storage,
      putRequest(await presignPut(storage), "text/html")
    );
    const download = await downloadRequest(
      storage,
      new Request(await presignGet(storage))
    );

    expect([upload.status, download.status]).toEqual([403, 404]);
    expect(await storage.head(REF)).toBeNull();
  });
});
