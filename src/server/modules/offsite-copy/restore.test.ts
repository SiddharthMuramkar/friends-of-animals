import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { bytesOf, streamOf } from "@/server/ports/copy-bucket.contract";
import { FakeCopyBucket } from "@/test/fakes/copy-bucket";
import { createHarness } from "@/test/harness";

import { restoreOffsiteFile } from "./restore";
import { runOffsiteCopy, type OffsiteDeps } from "./run-copy";

const FILES = "foa-files-prod";
const SPARE = "foa-restore-check";
const OFFSITE = "foa-offsite-b2";
const KEY = "submission/0190a1b2-0000-7000-8000-000000000001";

const utf8 = new TextEncoder();

function md5Hex(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

/** A production object copied to B2 by a nightly run, then lost from R2. */
async function world() {
  const h = await createHarness();
  const r2 = new FakeCopyBucket({ clock: h.clock });
  const b2 = new FakeCopyBucket({ clock: h.clock });
  const deps: OffsiteDeps = {
    db: h.db,
    clock: h.clock,
    errors: h.errors,
    source: r2,
    target: b2,
    config: {
      appEnv: "production",
      sourceBuckets: [FILES],
      targetBucket: OFFSITE,
      retention: { days: 30 },
      budgetMs: 2 * 60 * 60 * 1000,
      concurrency: 4,
    },
  };

  async function put(
    store: FakeCopyBucket,
    bucket: string,
    key: string,
    bytes: Uint8Array,
    metadata: Record<string, string> = {}
  ) {
    await store.write({
      bucket,
      key,
      body: streamOf(bytes),
      sizeBytes: bytes.length,
      contentType: "image/png",
      contentMd5: null,
      metadata,
    });
  }

  async function objectIn(bucket: string, key = KEY) {
    const read = await r2.read({ bucket, key });
    if (read === null) return null;
    const { body, ...rest } = read;
    return { ...rest, bytes: await bytesOf(body) };
  }

  const original = utf8.encode("the original photo");
  await put(r2, FILES, KEY, original, { "uploaded-by": "files" });
  await runOffsiteCopy(deps, { finalAttempt: false });
  await r2.delete({ bucket: FILES, key: KEY });

  const restore = (input: {
    bucket: string;
    key: string;
    to?: string;
    overwrite?: boolean;
  }) => restoreOffsiteFile(deps, input);

  return { r2, b2, original, put, objectIn, restore };
}

describe("restoreOffsiteFile", () => {
  it("copies a file back from B2 into the bucket it came from", async () => {
    const { original, objectIn, restore } = await world();

    expect(await restore({ bucket: FILES, key: KEY })).toEqual({
      ok: true,
      bucket: FILES,
      key: KEY,
      sizeBytes: original.length,
    });
    expect(await objectIn(FILES)).toEqual({
      bytes: original,
      sizeBytes: original.length,
      contentType: "image/png",
      etag: md5Hex(original),
      metadata: { "uploaded-by": "files" },
    });
  });

  it("restores into another bucket with `to`", async () => {
    const { original, objectIn, restore } = await world();

    expect(await restore({ bucket: FILES, key: KEY, to: SPARE })).toMatchObject(
      { ok: true, bucket: SPARE }
    );
    expect((await objectIn(SPARE))?.bytes).toEqual(original);
    expect(await objectIn(FILES)).toBeNull();
  });

  it("leaves an existing object alone unless told to overwrite it", async () => {
    const { r2, original, put, objectIn, restore } = await world();
    const newer = utf8.encode("a newer upload");
    await put(r2, FILES, KEY, newer);

    expect(await restore({ bucket: FILES, key: KEY })).toEqual({
      ok: false,
      reason: "target_exists",
    });
    expect((await objectIn(FILES))?.bytes).toEqual(newer);

    expect(
      await restore({ bucket: FILES, key: KEY, overwrite: true })
    ).toMatchObject({ ok: true });
    expect((await objectIn(FILES))?.bytes).toEqual(original);
  });

  it("says the backup has no copy of a key it never copied", async () => {
    const { objectIn, restore } = await world();

    expect(
      await restore({ bucket: FILES, key: "submission/never-uploaded" })
    ).toEqual({ ok: false, reason: "not_in_backup" });
    expect(await objectIn(FILES, "submission/never-uploaded")).toBeNull();
  });

  it("refuses a copy whose bytes don't match the etag R2 had", async () => {
    const { b2, put, objectIn, restore } = await world();
    await put(b2, OFFSITE, `${FILES}/${KEY}`, utf8.encode("bit rot"), {
      "foa-source-etag": md5Hex(utf8.encode("the original photo")),
    });

    expect(await restore({ bucket: FILES, key: KEY })).toEqual({
      ok: false,
      reason: "etag_mismatch",
    });
    expect(await objectIn(FILES)).toBeNull();
  });

  it("restores a multipart upload's copy, whose etag no MD5 can check", async () => {
    const { b2, put, objectIn, restore } = await world();
    const bytes = utf8.encode("uploaded in parts");
    await put(b2, OFFSITE, `${FILES}/${KEY}`, bytes, {
      "foa-source-etag": "0123456789abcdef0123456789abcdef-3",
    });

    expect(await restore({ bucket: FILES, key: KEY })).toMatchObject({
      ok: true,
    });
    expect((await objectIn(FILES))?.bytes).toEqual(bytes);
  });
});
