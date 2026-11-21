import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { offsiteCopy } from "@/server/db/schema";
import { streamOf, bytesOf } from "@/server/ports/copy-bucket.contract";
import { FakeCopyBucket } from "@/test/fakes/copy-bucket";
import { createHarness } from "@/test/harness";

import type { OffsiteConfig } from "./config";
import { OffsiteCopyIncompleteError } from "./errors";
import { runOffsiteCopy, type OffsiteDeps } from "./run-copy";

const FILES = "foa-files-prod";
const MEDIA = "foa-media-prod";
const OFFSITE = "foa-offsite-b2";
const HOUR_MS = 60 * 60 * 1000;

const utf8 = new TextEncoder();

function md5Hex(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

async function world(config: Partial<OffsiteConfig> = {}) {
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
      budgetMs: 2 * HOUR_MS,
      concurrency: 4,
      ...config,
    },
  };

  /** Stores an object in R2 as an upload would. */
  async function upload(
    key: string,
    content: string,
    options: { bucket?: string; contentType?: string } = {}
  ) {
    const bytes = utf8.encode(content);
    await r2.write({
      bucket: options.bucket ?? FILES,
      key,
      body: streamOf(bytes),
      sizeBytes: bytes.length,
      contentType: options.contentType ?? "image/jpeg",
      contentMd5: null,
      metadata: {},
    });
    return bytes;
  }

  /** The B2 copy of an R2 object, or null. */
  async function copyOf(key: string, bucket = FILES) {
    const read = await b2.read({ bucket: OFFSITE, key: `${bucket}/${key}` });
    if (read === null) return null;
    const { body, ...rest } = read;
    return { ...rest, bytes: await bytesOf(body) };
  }

  async function offsiteKeys(): Promise<string[]> {
    const keys: string[] = [];
    for await (const { key } of b2.list({ bucket: OFFSITE })) keys.push(key);
    return keys;
  }

  /** Deletes an object from R2, as deleting a file would. */
  async function remove(key: string, bucket = FILES) {
    await r2.delete({ bucket, key });
  }

  /** The manifest rows, by key. */
  async function manifest() {
    const rows = await h.db.select().from(offsiteCopy);
    return Object.fromEntries(rows.map((row) => [row.key, row]));
  }

  const run = (input = { finalAttempt: false }) => runOffsiteCopy(deps, input);

  /** The error an incomplete run throws. */
  async function incompleteRun(input = { finalAttempt: false }) {
    const error: unknown = await run(input).then(
      (report) => report,
      (thrown: unknown) => thrown
    );
    if (!(error instanceof OffsiteCopyIncompleteError)) {
      const got = error instanceof Error ? error.stack : JSON.stringify(error);
      throw new Error(`Expected an incomplete run, got ${got}`);
    }
    return error;
  }

  return {
    h,
    r2,
    b2,
    deps,
    upload,
    remove,
    copyOf,
    offsiteKeys,
    manifest,
    run,
    incompleteRun,
  };
}

describe("runOffsiteCopy: what gets copied", () => {
  it("copies a new object to <bucket>/<key> in B2 with its bytes, type and etag", async () => {
    const { h, upload, copyOf, run } = await world();
    const bytes = await upload(
      "submission/0190a1b2-0000-7000-8000-000000000001",
      "photo",
      {
        contentType: "image/png",
      }
    );

    const report = await run();

    expect(report).toMatchObject({ status: "complete", copied: 1, failed: 0 });
    expect(
      await copyOf("submission/0190a1b2-0000-7000-8000-000000000001")
    ).toEqual({
      bytes,
      sizeBytes: bytes.length,
      contentType: "image/png",
      etag: md5Hex(bytes),
      metadata: { "foa-source-etag": md5Hex(bytes) },
    });
    expect(await h.db.select().from(offsiteCopy)).toEqual([
      {
        sourceBucket: FILES,
        key: "submission/0190a1b2-0000-7000-8000-000000000001",
        etag: md5Hex(bytes),
        sizeBytes: bytes.length,
        sourceLastModified: h.clock.now(),
        copiedAt: h.clock.now(),
        deletedInSourceAt: null,
      },
    ]);
  });

  it("copies an object again once its bytes change", async () => {
    const { h, upload, copyOf, run } = await world();
    await upload("avatar/a", "first");
    await run();
    h.clock.advance({ days: 1 });
    const changed = await upload("avatar/a", "second, longer");

    const report = await run();

    expect(report).toMatchObject({ copied: 1, unchanged: 0 });
    expect((await copyOf("avatar/a"))?.bytes).toEqual(changed);
  });

  it("copies an object again when only its etag changes", async () => {
    const { h, upload, copyOf, run } = await world();
    await upload("avatar/a", "aaaa");
    await run();
    h.clock.advance({ days: 1 });
    const changed = await upload("avatar/a", "bbbb");

    expect(await run()).toMatchObject({ copied: 1 });
    expect((await copyOf("avatar/a"))?.bytes).toEqual(changed);
  });

  it("doesn't write an unchanged object again", async () => {
    const { h, b2, upload, run } = await world();
    await upload("avatar/a", "same");
    await run();
    const writes = b2.writes.length;
    h.clock.advance({ days: 1 });

    const report = await run();

    expect(report).toMatchObject({
      status: "complete",
      copied: 0,
      unchanged: 1,
    });
    expect(b2.writes).toHaveLength(writes);
  });

  it("never copies keys under staging/, local/, pr-<n>/ or br-<hash>/", async () => {
    const { upload, offsiteKeys, run } = await world();
    await upload("staging/avatar/a", "x");
    await upload("local/avatar/b", "x");
    await upload("pr-142/avatar/c", "x");
    await upload("br-0a1b2c3d/avatar/d", "x");
    await upload("avatar/e", "x");

    const report = await run();

    expect(report).toMatchObject({ copied: 1, skippedNonProduction: 4 });
    expect(await offsiteKeys()).toEqual([`${FILES}/avatar/e`]);
  });

  it("lists only the configured source buckets", async () => {
    const { upload, offsiteKeys, run } = await world({
      sourceBuckets: [FILES],
    });
    await upload("avatar/a", "x");
    await upload("gallery/b", "x", { bucket: MEDIA });

    await run();

    expect(await offsiteKeys()).toEqual([`${FILES}/avatar/a`]);
  });

  it("copies every configured source bucket under its own name", async () => {
    const { upload, offsiteKeys, run } = await world({
      sourceBuckets: [FILES, MEDIA],
    });
    await upload("avatar/a", "x");
    await upload("gallery/b", "x", { bucket: MEDIA });

    expect(await run()).toMatchObject({ status: "complete", copied: 2 });
    expect(await offsiteKeys()).toEqual([
      `${FILES}/avatar/a`,
      `${MEDIA}/gallery/b`,
    ]);
  });

  it.each(["local", "preview", "staging"] as const)(
    "copies nothing when APP_ENV is %s",
    async (appEnv) => {
      const { h, b2, upload, run } = await world({ appEnv });
      await upload("avatar/a", "x");

      expect(await run()).toEqual({
        status: "skipped",
        reason: "not_production",
      });
      expect(b2.writes).toEqual([]);
      expect(await h.db.select().from(offsiteCopy)).toEqual([]);
    }
  );
});

describe("runOffsiteCopy: the retention window", () => {
  const RETENTION_MS = 30 * 24 * HOUR_MS;

  it("marks an object gone from R2 and keeps its copy", async () => {
    const { h, upload, remove, copyOf, manifest, run } = await world();
    const bytes = await upload("avatar/a", "keep me");
    await run();
    h.clock.advance({ hours: 20 });
    await remove("avatar/a");

    const report = await run();

    expect(report).toMatchObject({
      status: "complete",
      markedDeleted: 1,
      purged: 0,
    });
    expect((await copyOf("avatar/a"))?.bytes).toEqual(bytes);
    expect((await manifest())["avatar/a"]?.deletedInSourceAt).toEqual(
      h.clock.now()
    );
  });

  it("deletes the copy once the window has passed, and not a millisecond before", async () => {
    const { h, upload, remove, copyOf, manifest, run } = await world();
    await upload("avatar/a", "keep me");
    await upload("avatar/b", "still here");
    await run();
    await remove("avatar/a");
    await run();

    h.clock.advance(RETENTION_MS - 1);
    expect(await run()).toMatchObject({ held: 1, purged: 0 });
    expect(await copyOf("avatar/a")).not.toBeNull();

    h.clock.advance(1);
    expect(await run()).toMatchObject({
      status: "complete",
      held: 0,
      purged: 1,
    });
    expect(await copyOf("avatar/a")).toBeNull();
    expect(Object.keys(await manifest())).toEqual(["avatar/b"]);
  });

  it("unmarks an object back in R2 unchanged, without copying it again", async () => {
    const { h, b2, upload, remove, copyOf, manifest, run } = await world();
    await upload("avatar/a", "same bytes");
    await run();
    await remove("avatar/a");
    await run();
    h.clock.advance({ days: 10 });
    await upload("avatar/a", "same bytes");
    const writes = b2.writes.length;

    expect(await run()).toMatchObject({ clearedDeleted: 1, copied: 0 });
    expect(b2.writes).toHaveLength(writes);
    expect((await manifest())["avatar/a"]?.deletedInSourceAt).toBeNull();

    h.clock.advance(RETENTION_MS);
    expect(await run()).toMatchObject({ purged: 0, unchanged: 1 });
    expect(await copyOf("avatar/a")).not.toBeNull();
  });

  it("copies an object back in R2 changed, and unmarks it", async () => {
    const { h, upload, remove, copyOf, manifest, run } = await world();
    await upload("avatar/a", "old");
    await run();
    await remove("avatar/a");
    await run();
    h.clock.advance({ days: 10 });
    const changed = await upload("avatar/a", "new bytes");

    expect(await run()).toMatchObject({ copied: 1, clearedDeleted: 0 });
    expect((await copyOf("avatar/a"))?.bytes).toEqual(changed);
    expect((await manifest())["avatar/a"]?.deletedInSourceAt).toBeNull();
  });

  it("refuses a bucket whose listing is empty while B2 holds live copies", async () => {
    const { h, upload, remove, copyOf, manifest, run, incompleteRun } =
      await world();
    await upload("avatar/a", "x");
    await upload("avatar/b", "y");
    await run();
    await remove("avatar/a");
    await remove("avatar/b");
    h.clock.advance(RETENTION_MS);

    const error = await incompleteRun();

    expect(error.report).toMatchObject({
      status: "incomplete",
      failedBuckets: [FILES],
      markedDeleted: 0,
      purged: 0,
    });
    expect(await copyOf("avatar/a")).not.toBeNull();
    expect(await copyOf("avatar/b")).not.toBeNull();
    const rows = await manifest();
    expect(rows["avatar/a"]?.deletedInSourceAt).toBeNull();
    expect(rows["avatar/b"]?.deletedInSourceAt).toBeNull();
  });
});
