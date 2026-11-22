// The media job (#85): once the scan passes, worker-media makes each image's
// derivatives. Driven through `h.drain()` after a real upload, with the
// scanner, storage and media fakes.
//
// The job's outcome events (files.file_processed, files.file_processing_
// failed) have no subscriber until #85's Entries unit adds one, and emit()
// stores nothing for an event nobody listens to. So these tests check the
// outcome the events announce, the file_processing row, and the Entries
// unit's tests check the events once it listens.

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  fileAsset,
  fileDerivative,
  fileProcessing,
  outbox,
} from "@/server/db/schema";
import { DEFAULT_RETRY_POLICY, drainUntilIdle } from "@/server/outbox";
import { emit } from "@/server/outbox/emit";
import { EICAR_TEST_BYTES } from "@/test/eicar";
import { createHarness, TEST_FILES, type Harness } from "@/test/harness";
import { readMediaFixture } from "@/test/media-fixtures";
import { webpSize } from "@/test/webp";

const JPEG = readMediaFixture("gpsJpeg");
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

async function world() {
  return createHarness();
}

/** A member uploads `bytes` declared as `contentType` and completes it. */
async function upload(h: Harness, contentType: string, bytes: Uint8Array) {
  const owner = await h.signIn(await h.seed.member());
  const requested = await h.as(owner).requestUpload({
    purpose: "test_upload",
    contentType,
    sizeBytes: bytes.length,
  });
  if (!requested.ok) throw new Error(`refused: ${requested.error}`);
  const stored = await h.storage.put(
    requested.uploadUrl,
    bytes,
    requested.headers
  );
  if (!stored.ok) throw new Error(`not stored: ${stored.error}`);
  const completed = await h
    .as(owner)
    .completeUpload({ fileId: requested.fileId });
  if (!completed.ok) throw new Error(`not completed: ${completed.error}`);
  return { owner, fileId: requested.fileId };
}

async function processing(h: Harness, fileId: string) {
  const [row] = await h.db
    .select()
    .from(fileProcessing)
    .where(eq(fileProcessing.fileAssetId, fileId));
  return row ?? null;
}

async function derivatives(h: Harness, fileId: string) {
  return h.db
    .select()
    .from(fileDerivative)
    .where(eq(fileDerivative.fileAssetId, fileId))
    .orderBy(fileDerivative.kind);
}

async function mediaDeliveries(h: Harness) {
  return h.db
    .select({ status: outbox.status, attempts: outbox.attempts })
    .from(outbox)
    .where(eq(outbox.handler, "files.process_image"));
}

/** Emits files.processing_requested for `fileId` again, as a redelivery would. */
async function requestAgain(h: Harness, fileId: string) {
  await h.db.transaction((tx) =>
    emit(tx, h.clock, {
      type: "files.processing_requested",
      aggregate: { type: "file_asset", id: fileId },
      payload: { fileId },
    })
  );
}

describe("the media job", () => {
  it("makes a clean image's derivatives once its scan passes", async () => {
    const h = await world();
    const { fileId } = await upload(h, "image/jpeg", JPEG);
    h.clock.advance({ minutes: 1 });

    await h.drain();

    expect(await processing(h, fileId)).toMatchObject({
      status: "done",
      errorCode: null,
      attempts: 1,
      finishedAt: h.clock.now(),
    });
    const rows = await derivatives(h, fileId);
    expect(rows).toMatchObject([
      {
        kind: "display_1600",
        width: 1600,
        height: 1200,
        contentType: "image/webp",
        bucket: TEST_FILES.bucket,
        storageKey: `local/derived/${fileId}/display_1600.webp`,
        createdAt: h.clock.now(),
      },
      {
        kind: "thumb_320",
        width: 320,
        height: 240,
        contentType: "image/webp",
        bucket: TEST_FILES.bucket,
        storageKey: `local/derived/${fileId}/thumb_320.webp`,
      },
    ]);
    for (const row of rows) {
      const stored = await h.storage.head({
        bucket: row.bucket,
        key: row.storageKey,
      });
      expect(stored).toEqual({
        sizeBytes: row.sizeBytes,
        contentType: "image/webp",
      });
    }
    expect(h.media.processed).toEqual([
      { bytes: JPEG, kinds: ["thumb_320", "display_1600"] },
    ]);
  });

  it("stores the bytes the media processor made", async () => {
    const h = await world();
    const { fileId } = await upload(h, "image/jpeg", JPEG);

    await h.drain();

    const [display] = await derivatives(h, fileId);
    const object = await h.storage.read({
      bucket: display!.bucket,
      key: display!.storageKey,
    });
    const bytes = new Uint8Array(await new Response(object).arrayBuffer());
    expect(webpSize(bytes)).toEqual({ width: 1600, height: 1200 });
  });

  it("records why an image can't be processed, and makes nothing", async () => {
    const h = await world();
    h.media.failNext(1, "media_decode_failed");
    const { fileId } = await upload(h, "image/jpeg", JPEG);

    expect(await h.drain()).toMatchObject({ failed: 0 });

    expect(await processing(h, fileId)).toMatchObject({
      status: "failed",
      errorCode: "media_decode_failed",
      finishedAt: h.clock.now(),
    });
    expect(await derivatives(h, fileId)).toEqual([]);
    expect(
      h.storage.keys(TEST_FILES.bucket).filter((key) => key.includes("derived"))
    ).toEqual([]);
  });

  it("queues nothing for a clean file that gets no derivatives", async () => {
    const h = await world();
    const { fileId } = await upload(h, "application/pdf", PDF);

    await h.drain();

    expect((await h.db.select().from(fileAsset))[0]).toMatchObject({
      id: fileId,
      status: "clean",
    });
    expect(await processing(h, fileId)).toBeNull();
    expect(await mediaDeliveries(h)).toEqual([]);
    expect(h.media.processed).toEqual([]);
  });

  describe("before the scan passes", () => {
    it("queues nothing for a file that hasn't been scanned", async () => {
      const h = await world();
      h.scanner.failNext(1);
      const { fileId } = await upload(h, "image/jpeg", JPEG);

      await h.drain();

      expect((await h.db.select().from(fileAsset))[0]).toMatchObject({
        id: fileId,
        status: "scanning",
      });
      expect(await processing(h, fileId)).toBeNull();
      expect(await mediaDeliveries(h)).toEqual([]);
      expect(h.media.processed).toEqual([]);
    });

    it("queues nothing for a quarantined file", async () => {
      const h = await world();
      const { fileId } = await upload(h, "image/png", EICAR_TEST_BYTES);

      await h.drain();

      expect((await h.db.select().from(fileAsset))[0]).toMatchObject({
        id: fileId,
        status: "quarantined",
      });
      expect(await processing(h, fileId)).toBeNull();
      expect(await mediaDeliveries(h)).toEqual([]);
      expect(h.media.processed).toEqual([]);
    });

    it("processes nothing when asked about a file that isn't clean", async () => {
      const h = await world();
      h.scanner.failNext(1);
      const { fileId } = await upload(h, "image/jpeg", JPEG);
      await h.drain();

      await requestAgain(h, fileId);
      expect(await h.drain()).toMatchObject({ dispatched: 1, failed: 0 });

      expect(h.media.processed).toEqual([]);
      expect(await derivatives(h, fileId)).toEqual([]);
    });
  });

  it("records nothing for a file that stops being clean while it is processed", async () => {
    const h = await world();
    const { fileId } = await upload(h, "image/jpeg", JPEG);
    const media = h.deps.media;
    h.deps.media = {
      async processImage(input) {
        const result = await media.processImage(input);
        // Clean only ever leaves for deleted (domain/file-status.ts).
        await h.db
          .update(fileAsset)
          .set({ status: "deleted" })
          .where(eq(fileAsset.id, fileId));
        return result;
      },
    };

    await h.drain();

    expect(await derivatives(h, fileId)).toEqual([]);
    expect(await processing(h, fileId)).toMatchObject({ status: "queued" });
  });

  it("makes each derivative once when the job is delivered twice", async () => {
    const h = await world();
    const { fileId } = await upload(h, "image/jpeg", JPEG);
    await h.drain();
    const finished = await processing(h, fileId);
    const made = await derivatives(h, fileId);

    h.clock.advance({ minutes: 5 });
    await requestAgain(h, fileId);
    await h.drain();
    await h.drain();

    expect(h.media.processed).toHaveLength(1);
    // Finished once: a redelivery neither touches the job nor remakes a
    // derivative, so it can't announce the outcome a second time.
    expect(await processing(h, fileId)).toEqual(finished);
    expect(finished).toMatchObject({ status: "done", attempts: 1 });
    expect(await derivatives(h, fileId)).toEqual(made);
    expect(made).toHaveLength(2);
  });

  it("retries a processor that fails without a verdict, then records the failure", async () => {
    const h = await world();
    const { fileId } = await upload(h, "image/jpeg", JPEG);
    h.deps.media = {
      processImage: () =>
        Promise.reject(new Error("worker-media ran out of memory")),
    };

    await h.drain();
    expect(await processing(h, fileId)).toMatchObject({
      status: "queued",
      attempts: 1,
    });
    for (
      let attempt = 2;
      attempt <= DEFAULT_RETRY_POLICY.maxAttempts;
      attempt += 1
    ) {
      h.clock.advance({ minutes: 30 });
      await h.drain();
    }

    expect(await processing(h, fileId)).toMatchObject({
      status: "failed",
      errorCode: "processing_error",
      attempts: DEFAULT_RETRY_POLICY.maxAttempts,
    });
    expect(await mediaDeliveries(h)).toEqual([
      { status: "failed", attempts: DEFAULT_RETRY_POLICY.maxAttempts },
    ]);
  });

  it("records a failed outcome when it can never write the derivatives", async () => {
    const h = await world();
    const { fileId } = await upload(h, "image/jpeg", JPEG);
    h.storage.write = async () => {
      throw new Error("The object store is unavailable");
    };

    for (
      let attempt = 1;
      attempt <= DEFAULT_RETRY_POLICY.maxAttempts;
      attempt += 1
    ) {
      await h.drain();
      h.clock.advance({ minutes: 30 });
    }

    expect(await processing(h, fileId)).toMatchObject({
      status: "failed",
      errorCode: "processing_error",
      attempts: DEFAULT_RETRY_POLICY.maxAttempts,
    });
    expect(await derivatives(h, fileId)).toEqual([]);
    expect(await mediaDeliveries(h)).toEqual([
      { status: "failed", attempts: DEFAULT_RETRY_POLICY.maxAttempts },
    ]);
  });

  describe("the media queue", () => {
    it("is left alone by the default relay", async () => {
      const h = await world();
      const { fileId } = await upload(h, "image/jpeg", JPEG);

      // The VPS worker and the preview drain route: scans, not media.
      await drainUntilIdle(h.deps);

      expect(await mediaDeliveries(h)).toEqual([
        { status: "pending", attempts: 0 },
      ]);
      expect(await processing(h, fileId)).toMatchObject({ status: "queued" });
    });

    it("runs only the media job in worker-media", async () => {
      const h = await world();
      const { fileId } = await upload(h, "image/jpeg", JPEG);
      await drainUntilIdle(h.deps, { queue: "media" });

      // Not scanned yet, so nothing was queued for worker-media.
      expect(await processing(h, fileId)).toBeNull();
      await drainUntilIdle(h.deps);
      await drainUntilIdle(h.deps, { queue: "media" });

      expect(await processing(h, fileId)).toMatchObject({ status: "done" });
      const scans = await h.db
        .select({ status: outbox.status })
        .from(outbox)
        .where(
          and(
            eq(outbox.handler, "files.scan_file"),
            eq(outbox.status, "dispatched")
          )
        );
      expect(scans).toHaveLength(1);
    });
  });
});
