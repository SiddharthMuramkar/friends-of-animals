import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createApp } from "@/server/app";
import { fileAsset, outbox } from "@/server/db/schema";
import type { ObjectStorage } from "@/server/ports/storage";
import { createHarness, type Harness } from "@/test/harness";

const MiB = 1024 * 1024;
const PNG = new Uint8Array(1234).fill(7);
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const pngUpload = {
  purpose: "test_upload",
  contentType: "image/png",
  sizeBytes: PNG.length,
} as const;

async function world() {
  const h = await createHarness();
  const owner = await h.seed.member();
  const actor = await h.signIn(owner);
  return { h, owner, actor };
}

async function fileRows(h: Harness) {
  return h.db.select().from(fileAsset);
}

async function uploadedEvents(h: Harness) {
  return h.db
    .select()
    .from(outbox)
    .where(eq(outbox.eventType, "files.file_uploaded"));
}

describe("requestUpload", () => {
  it("presigns an upload for a member and records the file as pending", async () => {
    const { h, owner, actor } = await world();

    const result = await h.as(actor).requestUpload(pngUpload);

    if (!result.ok) throw new Error(`refused: ${result.error}`);
    expect(result.fileId).toMatch(UUID_V7);
    expect(result.headers).toEqual({ "Content-Type": "image/png" });
    expect(result.expiresAt).toEqual(
      new Date(h.clock.now().getTime() + 10 * 60 * 1000)
    );
    expect(await fileRows(h)).toEqual([
      expect.objectContaining({
        id: result.fileId,
        ownerUserId: owner.id,
        purpose: "test_upload",
        contentType: "image/png",
        sizeBytes: PNG.length,
        bucket: h.deps.files.bucket,
        // Prefix, purpose and id: nothing the browser sent.
        storageKey: `local/test_upload/${result.fileId}`,
        status: "pending_upload",
        uploadedAt: null,
        createdAt: h.clock.now(),
      }),
    ]);
    expect(await h.storage.put(result.uploadUrl, PNG, result.headers)).toEqual({
      ok: true,
    });
    // The PUT lands at the upload key, never at the storage key: the URL
    // takes another PUT until it expires, so only completing writes there.
    expect(
      await h.storage.head({
        bucket: h.deps.files.bucket,
        key: `local/incoming/${result.fileId}`,
      })
    ).toEqual({ sizeBytes: PNG.length, contentType: "image/png" });
    expect(
      await h.storage.head({
        bucket: h.deps.files.bucket,
        key: `local/test_upload/${result.fileId}`,
      })
    ).toBeNull();
  });

  it("stores the declared type trimmed and lower-cased", async () => {
    const { h, actor } = await world();

    const result = await h
      .as(actor)
      .requestUpload({ ...pngUpload, contentType: " Image/PNG " });

    expect(result).toMatchObject({
      ok: true,
      headers: { "Content-Type": "image/png" },
    });
    expect((await fileRows(h))[0]?.contentType).toBe("image/png");
  });

  it("refuses a visitor", async () => {
    const h = await createHarness();

    await expect(
      h.as(h.visitor()).requestUpload(pngUpload)
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await fileRows(h)).toEqual([]);
  });

  it.each([
    [
      "a size over the purpose's limit",
      { sizeBytes: 10 * MiB + 1 },
      "too_large",
    ],
    ["an empty file", { sizeBytes: 0 }, "empty"],
    [
      "a type the purpose doesn't take",
      { contentType: "text/html" },
      "type_not_allowed",
    ],
    ["an SVG", { contentType: "image/svg+xml" }, "type_not_allowed"],
    ["an unknown purpose", { purpose: "avatar" }, "invalid_input"],
    ["a fractional size", { sizeBytes: 1.5 }, "invalid_input"],
    ["a size that isn't a number", { sizeBytes: "1234" }, "invalid_input"],
  ])("refuses %s and records nothing", async (_case, change, error) => {
    const { h, actor } = await world();

    const result = await h
      .as(actor)
      .requestUpload({ ...pngUpload, ...change } as never);

    expect(result).toMatchObject({ ok: false, error });
    expect(await fileRows(h)).toEqual([]);
  });

  it("accepts a file of exactly the purpose's limit", async () => {
    const { h, actor } = await world();

    const result = await h
      .as(actor)
      .requestUpload({ ...pngUpload, sizeBytes: 10 * MiB });

    expect(result.ok).toBe(true);
  });

  it("refuses test uploads in production", async () => {
    const { h, actor } = await world();
    const production = createApp({
      ...h.deps,
      files: { ...h.deps.files, appEnv: "production" },
    });

    expect(await production.as(actor).requestUpload(pngUpload)).toEqual({
      ok: false,
      error: "purpose_unavailable",
    });
    expect(await fileRows(h)).toEqual([]);
  });

  it("gives an upload URL that expires after 10 minutes", async () => {
    const { h, actor } = await world();
    const result = await h.as(actor).requestUpload(pngUpload);
    if (!result.ok) throw new Error(`refused: ${result.error}`);

    h.clock.advance({ minutes: 10, milliseconds: 1 });

    expect(await h.storage.put(result.uploadUrl, PNG, result.headers)).toEqual({
      ok: false,
      error: "expired",
    });
  });
});

/**
 * A member who has presigned a PNG upload. `uploadRef` is where the
 * browser's PUT lands, `storedRef` the file's storage key.
 */
async function presigned() {
  const ctx = await world();
  const result = await ctx.h.as(ctx.actor).requestUpload(pngUpload);
  if (!result.ok) throw new Error(`refused: ${result.error}`);
  const bucket = ctx.h.deps.files.bucket;
  const uploadRef = { bucket, key: `local/incoming/${result.fileId}` };
  const storedRef = { bucket, key: `local/test_upload/${result.fileId}` };
  return { ...ctx, ...result, uploadRef, storedRef };
}

/** `storage`, except that every move fails as an outage would. */
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

describe("completeUpload", () => {
  it("confirms the stored object and emits files.file_uploaded with it", async () => {
    const { h, actor, fileId, uploadUrl, headers, uploadRef, storedRef } =
      await presigned();
    await h.storage.put(uploadUrl, PNG, headers);
    h.clock.advance({ seconds: 5 });

    expect(await h.as(actor).completeUpload({ fileId })).toEqual({
      ok: true,
      fileId,
      status: "uploaded",
    });

    // Moved to the storage key, which no upload URL names.
    expect(await h.storage.head(storedRef)).toEqual({
      sizeBytes: PNG.length,
      contentType: "image/png",
    });
    expect(await h.storage.head(uploadRef)).toBeNull();
    expect(await fileRows(h)).toEqual([
      expect.objectContaining({
        id: fileId,
        status: "uploaded",
        uploadedAt: h.clock.now(),
        updatedAt: h.clock.now(),
      }),
    ]);
    expect(await uploadedEvents(h)).toEqual([
      expect.objectContaining({
        aggregateType: "file_asset",
        aggregateId: fileId,
        payload: { fileId },
        occurredAt: h.clock.now(),
        status: "pending",
      }),
    ]);
  });

  it("does nothing more when called again", async () => {
    const { h, actor, fileId, uploadUrl, headers } = await presigned();
    await h.storage.put(uploadUrl, PNG, headers);
    await h.as(actor).completeUpload({ fileId });

    expect(await h.as(actor).completeUpload({ fileId })).toEqual({
      ok: true,
      fileId,
      status: "uploaded",
    });
    expect(await uploadedEvents(h)).toHaveLength(1);
  });

  it("leaves the file pending while nothing has been uploaded", async () => {
    const { h, actor, fileId, uploadUrl, headers } = await presigned();

    expect(await h.as(actor).completeUpload({ fileId })).toEqual({
      ok: false,
      error: "upload_missing",
    });
    expect((await fileRows(h))[0]?.status).toBe("pending_upload");
    expect(await uploadedEvents(h)).toEqual([]);

    // The browser can still finish the upload and try again.
    await h.storage.put(uploadUrl, PNG, headers);
    expect(await h.as(actor).completeUpload({ fileId })).toMatchObject({
      ok: true,
      status: "uploaded",
    });
  });

  it("changes nothing when storage can't take the upload, so a retry can", async () => {
    const { h, actor, fileId, uploadUrl, headers, uploadRef } =
      await presigned();
    await h.storage.put(uploadUrl, PNG, headers);
    const outage = createApp({
      ...h.deps,
      storage: withFailingMove(h.deps.storage),
    });

    await expect(outage.as(actor).completeUpload({ fileId })).rejects.toThrow(
      "storage move failed"
    );
    expect((await fileRows(h))[0]?.status).toBe("pending_upload");
    expect(await uploadedEvents(h)).toEqual([]);
    expect(await h.storage.head(uploadRef)).not.toBeNull();

    expect(await h.as(actor).completeUpload({ fileId })).toMatchObject({
      ok: true,
      status: "uploaded",
    });
  });

  it("confirms an upload an earlier call moved but didn't confirm", async () => {
    const { h, actor, fileId, storedRef } = await presigned();
    // As if a call moved the object, then failed before its status change.
    h.storage.plant({ ...storedRef, bytes: PNG, contentType: "image/png" });

    expect(await h.as(actor).completeUpload({ fileId })).toEqual({
      ok: true,
      fileId,
      status: "uploaded",
    });
    expect(await uploadedEvents(h)).toHaveLength(1);
  });

  it.each([
    [
      "a size",
      { bytes: new Uint8Array(PNG.length + 1), contentType: "image/png" },
    ],
    ["a type", { bytes: PNG, contentType: "text/html" }],
    ["no type", { bytes: PNG, contentType: null }],
  ])(
    "rejects and deletes an object with %s other than declared",
    async (_case, stored) => {
      const { h, actor, fileId, uploadRef, storedRef } = await presigned();
      h.storage.plant({ ...uploadRef, ...stored });

      expect(await h.as(actor).completeUpload({ fileId })).toEqual({
        ok: false,
        error: "upload_rejected",
      });

      expect((await fileRows(h))[0]?.status).toBe("rejected");
      expect(await h.storage.head(uploadRef)).toBeNull();
      expect(await h.storage.head(storedRef)).toBeNull();
      expect(await uploadedEvents(h)).toEqual([]);
      expect(await h.as(actor).completeUpload({ fileId })).toEqual({
        ok: false,
        error: "upload_rejected",
      });
    }
  );

  it("refuses anyone but the uploader", async () => {
    const { h, fileId, uploadUrl, headers } = await presigned();
    await h.storage.put(uploadUrl, PNG, headers);
    const other = await h.signIn(await h.seed.member());
    const admin = await h.signIn(await h.seed.superAdmin());

    for (const actor of [other, admin, h.visitor()]) {
      await expect(
        h.as(actor).completeUpload({ fileId })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    expect((await fileRows(h))[0]?.status).toBe("pending_upload");
    const [events] = await h.db
      .select({ n: count() })
      .from(outbox)
      .where(eq(outbox.eventType, "files.file_uploaded"));
    expect(events?.n).toBe(0);
  });

  it("says when there is no such file, or the id isn't one", async () => {
    const { h, actor } = await world();

    expect(
      await h
        .as(actor)
        .completeUpload({ fileId: "01938a00-0000-7000-8000-000000000000" })
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await h.as(actor).completeUpload({ fileId: "../etc" })
    ).toMatchObject({ ok: false, error: "invalid_input", fields: ["fileId"] });
  });
});
