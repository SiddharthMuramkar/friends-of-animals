// The malware scan when the scanner or storage fails (#63): the file stays
// `scanning`, which only its uploader may open, the relay retries with
// backoff, and a scanner that never comes back ends in the failed list.
// It never fails open.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, fileAsset } from "@/server/db/schema";
import { listFailedDeliveries } from "@/server/outbox";
import type { ObjectStorage } from "@/server/ports/storage";
import { EICAR_TEST_BYTES } from "@/test/eicar";
import { createHarness, type Harness } from "@/test/harness";

const NOTHING = { dispatched: 0, retried: 0, failed: 0, skipped: 0 };
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

/** A member uploads `bytes` declared as `contentType` and completes it. */
async function upload(
  h: Harness,
  contentType = "image/png",
  bytes: Uint8Array = PNG
) {
  const owner = await h.signIn(await h.seed.member());
  const requested = await h.as(owner).requestUpload({
    purpose: "test_upload",
    contentType,
    sizeBytes: bytes.length,
  });
  if (!requested.ok) throw new Error(`refused: ${requested.error}`);
  const { fileId, uploadUrl, headers } = requested;
  await h.storage.put(uploadUrl, bytes, headers);
  const completed = await h.as(owner).completeUpload({ fileId });
  if (!completed.ok) throw new Error(`not completed: ${completed.error}`);
  return { owner, fileId };
}

async function fileRow(h: Harness, fileId: string) {
  const [row] = await h.db
    .select()
    .from(fileAsset)
    .where(eq(fileAsset.id, fileId));
  if (!row) throw new Error(`no file ${fileId}`);
  return row;
}

async function staffAdmin(h: Harness) {
  const staff = await h.seed.member({ name: "Meera Staff" });
  await h.seed.grant(staff, { role: "staff_admin", scope: { type: "global" } });
  return h.signIn(staff);
}

/** `storage`, except that every move fails. */
function withFailingMove(storage: ObjectStorage): ObjectStorage {
  return {
    presignPut: (input) => storage.presignPut(input),
    presignGet: (input) => storage.presignGet(input),
    head: (ref) => storage.head(ref),
    read: (ref) => storage.read(ref),
    write: (input) => storage.write(input),
    move: () => Promise.reject(new Error("storage move failed")),
    delete: (ref) => storage.delete(ref),
    deletePrefix: (input) => storage.deletePrefix(input),
  };
}

describe("a scanner outage", () => {
  it("leaves the file scanning, then scans it clean after the backoff", async () => {
    const h = await createHarness();
    const { owner, fileId } = await upload(h);
    const staff = await staffAdmin(h);
    h.scanner.failNext(1);

    expect(await h.drain()).toEqual({ ...NOTHING, retried: 1 });
    expect(await fileRow(h, fileId)).toMatchObject({
      status: "scanning",
      scanResult: null,
      scannedAt: null,
    });
    expect(await h.as(staff).getFileDownloadUrl({ fileId })).toEqual({
      ok: false,
      error: "file_not_ready",
    });
    expect(await h.as(owner).getFileDownloadUrl({ fileId })).toMatchObject({
      ok: true,
    });

    h.clock.advance({ seconds: 30 });
    // The scan, then the clean image's media job (#85).
    expect(await h.drain()).toEqual({ ...NOTHING, dispatched: 2 });

    expect(await fileRow(h, fileId)).toMatchObject({
      status: "clean",
      scanResult: "OK",
    });
    expect(h.scanner.scans).toBe(2);
  });

  it("that never ends leaves the file unscanned, in the failed list", async () => {
    const h = await createHarness();
    const { fileId } = await upload(h);
    const staff = await staffAdmin(h);
    h.scanner.failNext(Number.POSITIVE_INFINITY);

    let failed = 0;
    for (let pass = 0; pass < 10; pass += 1) {
      failed += (await h.drain()).failed;
      h.clock.advance({ hours: 1 });
    }

    expect(failed).toBe(1);
    expect(await listFailedDeliveries(h.db)).toEqual([
      expect.objectContaining({
        eventType: "files.file_uploaded",
        aggregateId: fileId,
        handler: "files.scan_file",
        attempts: 5,
        lastError: expect.stringContaining(
          `File ${fileId} got no scan verdict`
        ),
      }),
    ]);
    expect((await fileRow(h, fileId)).status).toBe("scanning");
    expect(await h.as(staff).getFileDownloadUrl({ fileId })).toEqual({
      ok: false,
      error: "file_not_ready",
    });
  });
});

describe("a scanner that passes a file without reading it all", () => {
  it("isn't trusted: the file stays scanning for a retry", async () => {
    const h = await createHarness();
    const { fileId } = await upload(h);
    h.deps.scanner = { scan: async () => ({ verdict: "clean" }) };

    expect(await h.drain()).toEqual({ ...NOTHING, retried: 1 });

    expect((await fileRow(h, fileId)).status).toBe("scanning");
  });
});

describe("storage failing during the scan", () => {
  it("leaves a file whose object can't be read scanning for a retry", async () => {
    const h = await createHarness();
    const { fileId } = await upload(h);
    const { bucket, storageKey } = await fileRow(h, fileId);
    await h.storage.delete({ bucket, key: storageKey });

    expect(await h.drain()).toEqual({ ...NOTHING, retried: 1 });

    expect((await fileRow(h, fileId)).status).toBe("scanning");
  });

  it("keeps an infected file scanning until its quarantine move succeeds", async () => {
    const h = await createHarness();
    const { fileId } = await upload(h, "application/pdf", EICAR_TEST_BYTES);
    const { storageKey } = await fileRow(h, fileId);
    const storage = h.deps.storage;
    h.deps.storage = withFailingMove(storage);

    expect(await h.drain()).toEqual({ ...NOTHING, retried: 1 });
    expect(await fileRow(h, fileId)).toMatchObject({
      status: "scanning",
      storageKey,
    });
    expect(
      await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "file.quarantined"))
    ).toEqual([]);

    h.deps.storage = storage;
    h.clock.advance({ seconds: 30 });
    expect(await h.drain()).toEqual({ ...NOTHING, dispatched: 1 });

    expect(await fileRow(h, fileId)).toMatchObject({
      status: "quarantined",
      storageKey: `local/quarantine/${fileId}`,
    });
  });
});
