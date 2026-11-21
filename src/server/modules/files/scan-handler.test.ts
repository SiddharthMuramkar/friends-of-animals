// The malware scan (#63): the worker's handler for files.file_uploaded,
// driven through `h.drain()` after a real upload.

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, fileAsset, outbox } from "@/server/db/schema";
import { emit } from "@/server/outbox";
import { EICAR_SIGNATURE, EICAR_TEST_BYTES } from "@/test/eicar";
import { createHarness, TEST_FILES, type Harness } from "@/test/harness";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG = new Uint8Array([
  ...PNG_SIGNATURE,
  ...new TextEncoder().encode("a harmless PNG for the scan test"),
]);
/** `sha256sum` of PNG. */
const PNG_SHA256 =
  "5deaa494bdc3cb95a69f7ec957d54cc2993b987bf3b968c5fc834f56aacde46a";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

/** A member uploads `bytes` declared as `contentType` and completes it. */
async function upload(h: Harness, contentType: string, bytes: Uint8Array) {
  const owner = await h.signIn(await h.seed.member());
  const requested = await h.as(owner).requestUpload({
    purpose: "test_upload",
    contentType,
    sizeBytes: bytes.length,
  });
  if (!requested.ok) throw new Error(`refused: ${requested.error}`);
  const { fileId, uploadUrl, headers } = requested;
  const stored = await h.storage.put(uploadUrl, bytes, headers);
  if (!stored.ok) throw new Error(`not stored: ${stored.error}`);
  const completed = await h.as(owner).completeUpload({ fileId });
  if (!completed.ok) throw new Error(`not completed: ${completed.error}`);
  return { owner, fileId, uploadUrl, headers };
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

/** Emits files.file_uploaded for `fileId` again, as a redelivery would. */
async function emitUploaded(h: Harness, fileId: string) {
  await h.db.transaction((tx) =>
    emit(tx, h.clock, {
      type: "files.file_uploaded",
      aggregate: { type: "file_asset", id: fileId },
      payload: { fileId },
    })
  );
}

async function scanDeliveries(h: Harness) {
  return h.db
    .select({ status: outbox.status })
    .from(outbox)
    .where(eq(outbox.handler, "files.scan_file"));
}

describe("the malware scan", () => {
  it("marks a harmless upload clean, with its hash and scan time", async () => {
    const h = await createHarness();
    const { fileId } = await upload(h, "image/png", PNG);
    h.clock.advance({ minutes: 1 });

    expect(await h.drain()).toMatchObject({ failed: 0 });
    // A clean image also gets its media job (#85): count the scan only.
    expect(await scanDeliveries(h)).toEqual([{ status: "dispatched" }]);

    const row = await fileRow(h, fileId);
    expect(row).toMatchObject({
      status: "clean",
      scanResult: "OK",
      sha256: PNG_SHA256,
      scannedAt: h.clock.now(),
      storageKey: `local/test_upload/${fileId}`,
    });
    expect(h.scanner.scans).toBe(1);
  });

  it("lets staff have a clean file", async () => {
    const h = await createHarness();
    const { fileId } = await upload(h, "image/png", PNG);
    const staff = await staffAdmin(h);
    expect(await h.as(staff).getFileDownloadUrl({ fileId })).toEqual({
      ok: false,
      error: "file_not_ready",
    });

    await h.drain();

    const result = await h.as(staff).getFileDownloadUrl({ fileId });
    if (!result.ok) throw new Error(`refused: ${result.error}`);
    expect(await h.storage.get(result.url)).toMatchObject({
      ok: true,
      bytes: PNG,
    });
  });

  describe("an infected upload", () => {
    async function infected() {
      const h = await createHarness();
      const { owner, fileId } = await upload(
        h,
        "application/pdf",
        EICAR_TEST_BYTES
      );
      h.clock.advance({ seconds: 30 });
      await h.drain();
      return { h, owner, fileId };
    }

    it("is quarantined under the signature's name", async () => {
      const { h, fileId } = await infected();

      expect(await fileRow(h, fileId)).toMatchObject({
        status: "quarantined",
        scanResult: EICAR_SIGNATURE,
        scannedAt: h.clock.now(),
        storageKey: `local/quarantine/${fileId}`,
      });
    });

    it("is moved to the quarantine folder", async () => {
      const { h, fileId } = await infected();

      const keys = h.storage.keys(TEST_FILES.bucket);
      expect(keys).toContain(`local/quarantine/${fileId}`);
      expect(keys).not.toContain(`local/test_upload/${fileId}`);
    });

    it("is never delivered, not even to its owner or a super admin", async () => {
      const { h, owner, fileId } = await infected();
      const readers = [
        owner,
        await staffAdmin(h),
        await h.signIn(await h.seed.superAdmin()),
      ];

      for (const reader of readers) {
        expect(await h.as(reader).getFileDownloadUrl({ fileId })).toEqual({
          ok: false,
          error: "file_unavailable",
        });
      }
    });

    it("is recorded in the audit log by the worker", async () => {
      const { h, fileId } = await infected();

      const entries = await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "file.quarantined"));
      expect(entries).toEqual([
        expect.objectContaining({
          occurredAt: h.clock.now(),
          actorKind: "system",
          actorProcess: "worker",
          actorUserId: null,
          entityType: "file_asset",
          entityId: fileId,
          before: {
            status: "scanning",
            storageKey: `local/test_upload/${fileId}`,
          },
          after: {
            status: "quarantined",
            storageKey: `local/quarantine/${fileId}`,
            scanResult: EICAR_SIGNATURE,
          },
        }),
      ]);
    });
  });

  describe("an upload whose bytes aren't the declared type", () => {
    it("is rejected as a type mismatch and its object deleted", async () => {
      const h = await createHarness();
      const { owner, fileId } = await upload(h, "image/png", JPEG);

      await h.drain();

      expect(await fileRow(h, fileId)).toMatchObject({
        status: "rejected",
        scanResult: "type_mismatch",
      });
      expect(h.storage.keys(TEST_FILES.bucket)).not.toContain(
        `local/test_upload/${fileId}`
      );
      expect(await h.as(owner).getFileDownloadUrl({ fileId })).toEqual({
        ok: false,
        error: "file_unavailable",
      });
    });
  });

  describe("at-least-once delivery", () => {
    it("scans once, however often it is drained", async () => {
      const h = await createHarness();
      const { fileId } = await upload(h, "image/png", PNG);

      await h.drain();
      await h.drain();

      expect(h.scanner.scans).toBe(1);
      expect((await fileRow(h, fileId)).status).toBe("clean");
    });

    it("scans once when the event is delivered again", async () => {
      const h = await createHarness();
      const { fileId } = await upload(h, "image/png", PNG);
      await h.drain();
      const scannedAt = (await fileRow(h, fileId)).scannedAt;
      h.clock.advance({ minutes: 5 });

      await emitUploaded(h, fileId);
      expect(await h.drain()).toMatchObject({ dispatched: 1, failed: 0 });

      expect(h.scanner.scans).toBe(1);
      expect(await fileRow(h, fileId)).toMatchObject({
        status: "clean",
        scannedAt,
      });
    });

    it("leaves a quarantined file where it is when delivered again", async () => {
      const h = await createHarness();
      const { fileId } = await upload(h, "application/pdf", EICAR_TEST_BYTES);
      await h.drain();

      await emitUploaded(h, fileId);
      await h.drain();

      expect(h.scanner.scans).toBe(1);
      expect(await fileRow(h, fileId)).toMatchObject({
        status: "quarantined",
        storageKey: `local/quarantine/${fileId}`,
      });
      const audits = await h.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "file.quarantined"),
            eq(auditLog.entityId, fileId)
          )
        );
      expect(audits).toHaveLength(1);
    });

    it("skips a file that isn't uploaded yet", async () => {
      const h = await createHarness();
      const owner = await h.signIn(await h.seed.member());
      const requested = await h.as(owner).requestUpload({
        purpose: "test_upload",
        contentType: "image/png",
        sizeBytes: PNG.length,
      });
      if (!requested.ok) throw new Error(`refused: ${requested.error}`);
      await h.storage.put(requested.uploadUrl, PNG, requested.headers);

      await emitUploaded(h, requested.fileId);
      expect(await h.drain()).toMatchObject({ dispatched: 1, failed: 0 });

      expect(h.scanner.scans).toBe(0);
      expect((await fileRow(h, requested.fileId)).status).toBe(
        "pending_upload"
      );
      expect(await scanDeliveries(h)).toEqual([{ status: "dispatched" }]);
    });
  });
});

// A presigned PUT isn't single-use: R2, like S3, takes the same URL again
// until it expires (10 minutes), with any body of the signed type and
// length. Whatever the uploader sends once completing has taken the file
// must never become what the scan passed or what staff open.
describe("the upload URL, used again", () => {
  /** A harmless PNG, as long as one carrying the EICAR test file. */
  const HARMLESS = new Uint8Array([
    ...PNG_SIGNATURE,
    ...new Uint8Array(EICAR_TEST_BYTES.length).fill(0x20),
  ]);
  /** The same type and length, with the EICAR test file inside. */
  const INFECTED = new Uint8Array([...PNG_SIGNATURE, ...EICAR_TEST_BYTES]);

  const sha256Of = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");

  /** What a staff admin is served for the file. */
  async function servedToStaff(h: Harness, fileId: string) {
    const result = await h.as(await staffAdmin(h)).getFileDownloadUrl({
      fileId,
    });
    if (!result.ok) throw new Error(`refused: ${result.error}`);
    const served = await h.storage.get(result.url);
    if (!served.ok) throw new Error(`not served: ${served.error}`);
    return served.bytes;
  }

  it("can't replace a file once its scan has passed", async () => {
    const h = await createHarness();
    const { fileId, uploadUrl, headers } = await upload(
      h,
      "image/png",
      HARMLESS
    );
    h.clock.advance({ minutes: 1 });
    await h.drain();
    expect((await fileRow(h, fileId)).status).toBe("clean");
    h.clock.advance({ minutes: 1 });

    // Storage takes it, as R2 would: the URL hasn't expired.
    expect(await h.storage.put(uploadUrl, INFECTED, headers)).toEqual({
      ok: true,
    });

    const served = await servedToStaff(h, fileId);
    expect(served).toEqual(HARMLESS);
    expect(sha256Of(served)).toBe((await fileRow(h, fileId)).sha256);
  });

  it("can't reach a file whose upload is complete but not yet scanned", async () => {
    const h = await createHarness();
    const { fileId, uploadUrl, headers } = await upload(
      h,
      "image/png",
      HARMLESS
    );

    expect(await h.storage.put(uploadUrl, INFECTED, headers)).toEqual({
      ok: true,
    });
    await h.drain();

    expect(await fileRow(h, fileId)).toMatchObject({
      status: "clean",
      sha256: sha256Of(HARMLESS),
    });
    expect(await servedToStaff(h, fileId)).toEqual(HARMLESS);
  });

  it("can't replace a file by completing it again", async () => {
    const h = await createHarness();
    const { owner, fileId, uploadUrl, headers } = await upload(
      h,
      "image/png",
      HARMLESS
    );
    await h.storage.put(uploadUrl, INFECTED, headers);

    expect(await h.as(owner).completeUpload({ fileId })).toEqual({
      ok: true,
      fileId,
      status: "uploaded",
    });
    await h.drain();

    expect((await fileRow(h, fileId)).status).toBe("clean");
    expect(await servedToStaff(h, fileId)).toEqual(HARMLESS);
  });
});
