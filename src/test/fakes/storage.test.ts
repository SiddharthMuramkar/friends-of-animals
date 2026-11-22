import { describe, expect, it } from "vitest";

import { objectStorageContract } from "@/server/ports/storage.contract";

import { FakeClock } from "./clock";
import { FakeStorage } from "./storage";

objectStorageContract("FakeStorage", async () => {
  const clock = new FakeClock();
  const storage = new FakeStorage(clock);
  return {
    storage,
    bucket: "foa-files-test",
    prefix: "contract/",
    upload: async (url, headers, bytes) =>
      (await storage.put(url, bytes, headers)).ok,
    download: async (url) => {
      const result = await storage.get(url);
      if (!result.ok) return null;
      const { bytes, contentType, contentDisposition, cacheControl } = result;
      return { bytes, contentType, contentDisposition, cacheControl };
    },
    wait: async (seconds) => {
      clock.advance({ seconds });
    },
  };
});

const BUCKET = "foa-files-test";
const BYTES = new Uint8Array([1, 2, 3]);

function world() {
  const clock = new FakeClock();
  return { clock, storage: new FakeStorage(clock) };
}

describe("FakeStorage", () => {
  it("accepts a URL up to the last millisecond of its life", async () => {
    const { clock, storage } = world();
    await storage.put(
      (
        await storage.presignPut({
          bucket: BUCKET,
          key: "local/a",
          contentType: "image/png",
          contentLength: 3,
          expiresInSeconds: 60,
        })
      ).url,
      BYTES,
      { "Content-Type": "image/png" }
    );
    const { url } = await storage.presignGet({
      bucket: BUCKET,
      key: "local/a",
      expiresInSeconds: 300,
      contentType: "image/png",
      disposition: "inline",
      filename: "a.png",
    });

    clock.advance({ seconds: 300 });
    expect((await storage.get(url)).ok).toBe(true);
    clock.advance(1);
    expect(await storage.get(url)).toEqual({ ok: false, error: "expired" });
  });

  it("says why it refused a request", async () => {
    const { storage } = world();
    const { url, headers } = await storage.presignPut({
      bucket: BUCKET,
      key: "local/a",
      contentType: "image/png",
      contentLength: 3,
      expiresInSeconds: 60,
    });

    expect(await storage.put(url, new Uint8Array(4), headers)).toEqual({
      ok: false,
      error: "header_mismatch",
    });
    expect(await storage.put(url, BYTES, {})).toEqual({
      ok: false,
      error: "header_mismatch",
    });
    expect(await storage.get(url)).toEqual({
      ok: false,
      error: "wrong_method",
    });
    expect(
      await storage.put(url.replace("local/a", "local/b"), BYTES, headers)
    ).toEqual({ ok: false, error: "bad_signature" });
    expect(
      await storage.put(url.replace("image%2Fpng", "text%2Fhtml"), BYTES, {
        "Content-Type": "text/html",
      })
    ).toEqual({ ok: false, error: "bad_signature" });
    expect(
      await storage.put(url, BYTES, { "content-type": "image/png" })
    ).toEqual({ ok: true });
  });

  it("refuses a URL another FakeStorage signed", async () => {
    const { storage } = world();
    const other = new FakeStorage(new FakeClock());
    const { url, headers } = await other.presignPut({
      bucket: BUCKET,
      key: "local/a",
      contentType: "image/png",
      contentLength: 3,
      expiresInSeconds: 60,
    });

    expect(await storage.put(url, BYTES, headers)).toEqual({
      ok: false,
      error: "bad_signature",
    });
  });

  it("plants an object as it is given and lists keys per bucket", async () => {
    const { storage } = world();
    storage.plant({
      bucket: BUCKET,
      key: "local/b",
      bytes: BYTES,
      contentType: null,
    });
    storage.plant({
      bucket: "other",
      key: "local/c",
      bytes: BYTES,
      contentType: "image/png",
    });

    expect(await storage.head({ bucket: BUCKET, key: "local/b" })).toEqual({
      sizeBytes: 3,
      contentType: null,
    });
    expect(storage.keys(BUCKET)).toEqual(["local/b"]);
  });
});
