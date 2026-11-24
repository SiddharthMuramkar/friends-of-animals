import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { auditLog, fileAsset, registration } from "@/server/db/schema";
import {
  offlinePaymentOf,
  openOrder,
  schoolWithStudents,
  signInStaff,
} from "@/server/modules/payments/testing";
import {
  confirmedAdult,
  submittedImage,
} from "@/server/modules/entries/testing";
import { SCHEDULES } from "@/server/outbox/schedules";
import { EICAR_TEST_BYTES } from "@/test/eicar";
import { createHarness, TEST_FILES, type Harness } from "@/test/harness";
import { readMediaFixture } from "@/test/media-fixtures";

import { retentionRunAuditSchema } from "./domain/retention-plan";

const WORKER = { kind: "system", process: "worker" } as const;
const schedule = SCHEDULES.find(
  ({ name }) => name === "privacy.retention_sweep"
)!;

async function upload(h: Harness) {
  const owner = await h.seed.member();
  const app = h.as(await h.signIn(owner));
  const requested = await app.requestUpload({
    purpose: "test_upload",
    contentType: "application/pdf",
    sizeBytes: EICAR_TEST_BYTES.length,
  });
  if (!requested.ok) throw new Error(requested.error);
  const { fileId, uploadUrl, headers } = requested;
  expect(await h.storage.put(uploadUrl, EICAR_TEST_BYTES, headers)).toEqual({
    ok: true,
  });
  expect(await app.completeUpload({ fileId })).toEqual(
    expect.objectContaining({ ok: true })
  );
  return { owner, fileId, key: `local/quarantine/${fileId}` };
}

async function assetIds(h: Harness) {
  const rows = await h.db.select({ id: fileAsset.id }).from(fileAsset);
  return rows.map(({ id }) => id).sort();
}

describe("quarantined file retention", () => {
  it("keeps referenced payment proof through the floor and a connected hold while retiring unrelated quarantine", async () => {
    const h = await createHarness();
    await h.settings.set("retention.enforce", true);
    const school = await schoolWithStudents(h);
    const { batchId } = await openOrder(school);
    const finance = await signInStaff(h);
    const app = h.as(finance.actor);
    const proof = await app.requestOfflinePaymentProofUpload({
      batchId,
      contentType: "application/pdf",
      sizeBytes: EICAR_TEST_BYTES.length,
    });
    if (!proof.ok) throw new Error(proof.error);
    expect(
      await h.storage.put(proof.uploadUrl, EICAR_TEST_BYTES, proof.headers)
    ).toEqual({ ok: true });
    expect(await app.completeUpload({ fileId: proof.fileId })).toMatchObject({
      ok: true,
    });
    expect(
      await app.recordOfflinePayment({
        batchId,
        method: "cheque",
        reference: "004512",
        amount: "1000",
        receivedOn: "2027-01-15",
        proofFileId: proof.fileId,
      })
    ).toMatchObject({ ok: true });

    const unrelated = await upload(h);
    await h.drain();
    const proofKey = `local/quarantine/${proof.fileId}`;
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual(
      [proofKey, unrelated.key].sort()
    );
    h.clock.advance({ days: 31 });

    const worker = h.as(WORKER);
    const expired = await worker.runRetentionSweep();
    expect(expired.policies.quarantinedFiles).toMatchObject({ deleted: 1 });
    expect(await assetIds(h)).toEqual([proof.fileId]);
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual([proofKey]);
    expect(await offlinePaymentOf(h, batchId)).toMatchObject({
      proofFileAssetId: proof.fileId,
    });

    h.clock.set("2035-03-31T18:29:59Z");
    const beforeFloor = await worker.runRetentionSweep();
    expect(beforeFloor.policies.financialRecords).toMatchObject({
      retainedByFloor: 1,
    });
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual([proofKey]);

    const admin = await h.seed.superAdmin();
    const staff = h.as(await h.signIn(admin));
    const hold = await staff.placeLegalHold({
      subjectType: "user",
      subjectId: school.coordinator.userId,
      reason: "Pending inquiry",
    });
    if (!hold.ok) throw new Error(hold.error);
    h.clock.set("2035-03-31T18:30:00Z");
    const held = await worker.runRetentionSweep();
    expect(held.policies.financialRecords).toMatchObject({ held: 1 });
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual([proofKey]);
    expect(await staff.releaseLegalHold({ holdId: hold.holdId })).toEqual({
      ok: true,
    });

    const [entry] = await h.db
      .select({ id: registration.participantProfileId })
      .from(registration)
      .where(eq(registration.id, school.registrationIds[0]!));
    const profileHold = {
      subjectType: "participant_profile",
      subjectId: entry!.id,
      reason: "Pending review of the participant's payment",
    };
    const heldProfile = await staff.placeLegalHold(profileHold);
    if (!heldProfile.ok) throw new Error(heldProfile.error);
    expect(
      (await worker.runRetentionSweep()).policies.financialRecords
    ).toMatchObject({ held: 1, anonymised: 0 });
    expect(await offlinePaymentOf(h, batchId)).toMatchObject({
      proofFileAssetId: proof.fileId,
      recordedByUserId: finance.userId,
    });
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual([proofKey]);
    expect(
      await staff.releaseLegalHold({ holdId: heldProfile.holdId })
    ).toEqual({ ok: true });

    const released = await worker.runRetentionSweep();
    expect(released.policies.financialRecords).toMatchObject({ anonymised: 1 });
    // Decision 2: offline_payment.proof_file_asset_id stays NOT NULL, so
    // the anonymised payment keeps naming its quarantined proof, and the
    // quarantine policy never purges a file a payment still names.
    expect(await offlinePaymentOf(h, batchId)).toMatchObject({
      proofFileAssetId: proof.fileId,
      recordedByUserId: null,
      amountMinor: 100_000n,
    });
    h.clock.advance({ days: 365 });
    const later = await worker.runRetentionSweep();
    expect(later.policies.financialRecords).toMatchObject({ anonymised: 0 });
    expect(later.policies.quarantinedFiles).toMatchObject({ deleted: 0 });
    expect(await assetIds(h)).toEqual([proof.fileId]);
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual([proofKey]);
  });

  it("retires a quarantined CMS image and clears its cover and body references without removing the draft", async () => {
    const h = await createHarness();
    await h.settings.set("retention.enforce", true);
    const editor = await h.seed.member();
    await h.seed.grant(editor, {
      role: "content_manager",
      scope: { type: "global" },
    });
    const app = h.as(await h.signIn(editor));
    const fields = {
      kind: "blog",
      slug: "kite-season",
      title: "Kite season",
      excerpt: "Volunteers set up bird-care points.",
    } as const;
    const created = await app.createPost({
      ...fields,
      body: { blocks: [], footnotes: [] },
    });
    if (!created.ok) throw new Error(created.error);
    const { postId } = created;
    const bytes = readMediaFixture("gpsJpeg");
    vi.spyOn(h.scanner, "scan").mockResolvedValueOnce({
      verdict: "infected",
      signature: "Synthetic scan result",
    });
    const image = await app.uploadPostImage({
      postId,
      contentType: "image/jpeg",
      sizeBytes: bytes.length,
    });
    if (!image.ok) throw new Error(image.error);
    const { fileId, postImageId } = image;
    expect(await h.storage.put(image.uploadUrl, bytes, image.headers)).toEqual({
      ok: true,
    });
    expect(await app.completeUpload({ fileId })).toMatchObject({ ok: true });
    const paragraph = { type: "paragraph", text: ["The editor's notes."] };
    const cover = { postImageId };
    const body = {
      blocks: [paragraph, { type: "image", postImageId }],
      footnotes: [],
    };
    expect(await app.updatePost({ postId, ...fields, cover, body })).toEqual({
      ok: true,
      tags: [],
    });
    await h.drain();
    const key = `local/quarantine/${fileId}`;
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual([key]);
    const draft = {
      ok: true,
      post: { cover, body, images: [{ id: postImageId, ready: false }] },
    };
    expect(await app.getPostForEdit({ postId })).toMatchObject(draft);

    h.clock.advance({ days: 30 });
    vi.spyOn(h.storage, "delete").mockRejectedValueOnce(
      new Error("Storage unavailable")
    );
    await expect(schedule.run(h.deps)).rejects.toThrow("Storage unavailable");
    expect(await app.getPostForEdit({ postId })).toMatchObject(draft);
    expect(await assetIds(h)).toEqual([fileId]);
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual([key]);
    await schedule.run(h.deps);

    expect(await assetIds(h)).toEqual([]);
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual([]);
    expect(await app.getPostForEdit({ postId })).toMatchObject({
      ok: true,
      post: {
        id: postId,
        title: fields.title,
        status: "draft",
        cover: null,
        body: { blocks: [paragraph], footnotes: [] },
        images: [],
      },
    });
  });

  it("keeps the first purge and its audit count when the second storage deletion fails", async () => {
    const h = await createHarness();
    await h.settings.set("retention.enforce", true);
    const first = await upload(h);
    h.clock.advance({ seconds: 1 });
    const second = await upload(h);
    await h.drain();
    h.clock.advance({ days: 30 });

    const deleteObject = h.storage.delete.bind(h.storage);
    const remove = vi
      .spyOn(h.storage, "delete")
      .mockImplementation(async (ref) => {
        if (ref.key === second.key) throw new Error("Storage unavailable");
        await deleteObject(ref);
      });
    const worker = h.as(WORKER);
    await expect(worker.runRetentionSweep()).rejects.toThrow(
      "Storage unavailable"
    );
    expect(await assetIds(h)).toEqual([second.fileId]);
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual([second.key]);
    expect(
      await h.db
        .select({ pending: fileAsset.quarantinePurgePending })
        .from(fileAsset)
    ).toEqual([{ pending: true }]);
    const counts = async () => {
      const audits = await h.db
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.action, "privacy.retention_run"))
        .orderBy(auditLog.id);
      return audits.map(
        ({ after }) =>
          retentionRunAuditSchema.parse(after).policies.quarantinedFiles
            ?.deleted
      );
    };
    expect(await counts()).toEqual([1]);

    remove.mockRestore();
    const admin = h.as(await h.signIn(await h.seed.superAdmin()));
    const hold = await admin.placeLegalHold({
      subjectType: "user",
      subjectId: second.owner.id,
      reason: "Pending inquiry",
    });
    if (!hold.ok) throw new Error(hold.error);
    const held = await worker.runRetentionSweep();
    expect(held.policies.quarantinedFiles).toMatchObject({
      deleted: 0,
      held: 1,
    });
    expect(await assetIds(h)).toEqual([second.fileId]);
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual([second.key]);
    expect(await admin.releaseLegalHold({ holdId: hold.holdId })).toEqual({
      ok: true,
    });

    await worker.runRetentionSweep();
    expect(await assetIds(h)).toEqual([]);
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual([]);
    expect(await counts()).toEqual([1, 0, 1]);
    expect(h.storage.keys(TEST_FILES.bucket)).not.toContain(first.key);
  });

  it("retires only expired unheld assets and their objects when the schedule enforces retention", async () => {
    const h = await createHarness();
    const expired = await upload(h);
    const held = await upload(h);
    await h.drain();

    const fresh = await upload(h);
    h.clock.advance({ days: 2 });
    await h.drain();
    // The fresh file was uploaded at the same time but quarantined later.
    h.clock.advance({ days: 29 });
    const admin = await h.seed.superAdmin();
    const staff = h.as(await h.signIn(admin));
    const hold = await staff.placeLegalHold({
      subjectType: "user",
      subjectId: held.owner.id,
      reason: "Pending inquiry",
    });
    if (!hold.ok) throw new Error(hold.error);

    const initialKeys = [expired.key, held.key, fresh.key].sort();
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual(initialKeys);
    const preview = await staff.previewRetentionSweep();
    await schedule.run(h.deps);
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual(initialKeys);
    expect(await assetIds(h)).toEqual(
      [expired.fileId, held.fileId, fresh.fileId].sort()
    );

    await h.settings.set("retention.enforce", true);
    await schedule.run(h.deps);
    await h.drain();
    expect(await assetIds(h)).toEqual([held.fileId, fresh.fileId].sort());
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual(
      [held.key, fresh.key].sort()
    );
    expect(preview.policies.quarantinedFiles).toMatchObject({
      deleted: 1,
      held: 1,
    });

    expect(await staff.releaseLegalHold({ holdId: hold.holdId })).toEqual({
      ok: true,
    });
    await schedule.run(h.deps);
    expect(await assetIds(h)).toEqual([fresh.fileId]);
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual([fresh.key]);
  });

  it("retries storage failure when the object moved before its asset row followed", async () => {
    const h = await createHarness();
    await h.settings.set("retention.enforce", true);
    const file = await upload(h);
    await h.drain();
    // The scanner can lose its connection after moving the object.
    await h.db
      .update(fileAsset)
      .set({ storageKey: `local/test_upload/${file.fileId}` })
      .where(eq(fileAsset.id, file.fileId));
    h.clock.advance({ days: 30 });
    const removeObject = vi.spyOn(h.storage, "delete");
    removeObject.mockRejectedValueOnce(new Error("Storage unavailable"));

    await expect(schedule.run(h.deps)).rejects.toThrow("Storage unavailable");
    expect(await assetIds(h)).toEqual([file.fileId]);
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual([file.key]);

    await schedule.run(h.deps);
    expect(await assetIds(h)).toEqual([]);
    expect(h.storage.keys(TEST_FILES.bucket)).toEqual([]);
  });
  it("keeps a quarantined entry upload the entry still names and goes on with the rest of the run", async () => {
    const h = await createHarness();
    await h.settings.set("retention.enforce", true);
    const asha = await confirmedAdult(h);
    vi.spyOn(h.scanner, "scan").mockResolvedValueOnce({
      verdict: "infected",
      signature: "fixture verdict",
    });
    await submittedImage(h, asha);
    await h.drain();
    const [entryUpload] = await h.db
      .select({ id: fileAsset.id, status: fileAsset.status })
      .from(fileAsset);
    expect(entryUpload?.status).toBe("quarantined");

    const unrelated = await upload(h);
    await h.drain();
    h.clock.advance({ days: 31 });

    // entry_file.file_asset_id blocks the delete: purging the upload would
    // fail and stop every policy after this one.
    const run = await h.as(WORKER).runRetentionSweep();
    expect(run.policies.quarantinedFiles).toMatchObject({ deleted: 1 });
    expect(await assetIds(h)).toEqual([entryUpload!.id]);
    expect(h.storage.keys(TEST_FILES.bucket)).not.toContain(unrelated.key);
  });
});
