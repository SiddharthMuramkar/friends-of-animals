// Delivering a derivative (#85): signed, short-lived, and allowed exactly
// when its parent file may be read and is clean.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog, fileAsset } from "@/server/db/schema";
import { EICAR_TEST_BYTES } from "@/test/eicar";
import { createHarness, type Harness } from "@/test/harness";
import { readMediaFixture } from "@/test/media-fixtures";
import { webpSize } from "@/test/webp";

import type { FileStatus } from "./domain/file-status";

const JPEG = readMediaFixture("gpsJpeg");
const MISSING = "01938a00-0000-7000-8000-000000000000";

/** `owner` uploads `bytes` as `contentType` and completes it. */
async function upload(
  h: Harness,
  owner: Awaited<ReturnType<Harness["signIn"]>>,
  contentType: string,
  bytes: Uint8Array
) {
  const requested = await h.as(owner).requestUpload({
    purpose: "test_upload",
    contentType,
    sizeBytes: bytes.length,
  });
  if (!requested.ok) throw new Error(`refused: ${requested.error}`);
  await h.storage.put(requested.uploadUrl, bytes, requested.headers);
  const completed = await h
    .as(owner)
    .completeUpload({ fileId: requested.fileId });
  if (!completed.ok) throw new Error(`not completed: ${completed.error}`);
  return requested.fileId;
}

/** A member's JPEG, uploaded and processed, and everyone who might ask. */
async function world(
  options: { bytes?: Uint8Array; contentType?: string } = {}
) {
  const h = await createHarness();
  const ownerUser = await h.seed.member();
  const owner = await h.signIn(ownerUser);
  const fileId = await upload(
    h,
    owner,
    options.contentType ?? "image/jpeg",
    options.bytes ?? JPEG
  );
  const staffUser = await h.seed.member({ name: "Meera Staff" });
  await h.seed.grant(staffUser, {
    role: "staff_admin",
    scope: { type: "global" },
  });
  const actors = {
    owner,
    otherMember: await h.signIn(await h.seed.member()),
    staffAdmin: await h.signIn(staffUser),
    superAdmin: await h.signIn(await h.seed.superAdmin()),
    visitor: h.visitor(),
  };
  return { h, fileId, staffUser, actors };
}

async function setStatus(h: Harness, fileId: string, status: FileStatus) {
  await h.db.update(fileAsset).set({ status }).where(eq(fileAsset.id, fileId));
}

async function derivativeReads(h: Harness) {
  return h.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, "file.derivative_read"));
}

describe("getFileDerivativeUrl", () => {
  it("gives the owner a URL that serves the derivative inline", async () => {
    const { h, fileId, actors } = await world();
    await h.drain();

    const result = await h
      .as(actors.owner)
      .getFileDerivativeUrl({ fileId, kind: "thumb_320" });

    expect(result).toEqual({
      ok: true,
      url: expect.any(String),
      expiresAt: new Date(h.clock.now().getTime() + 300_000),
      width: 320,
      height: 240,
    });
    if (!result.ok) return;
    const served = await h.storage.get(result.url);
    if (!served.ok) throw new Error(`not served: ${served.error}`);
    expect(webpSize(served.bytes)).toEqual({ width: 320, height: 240 });
    expect(served.contentType).toBe("image/webp");
    expect(served.contentDisposition).toBe(
      `inline; filename="test_upload-${fileId.slice(0, 8)}-thumb_320.webp"`
    );
  });

  it.each([
    ["the owner", "owner", true],
    ["a staff admin", "staffAdmin", true],
    ["a super admin", "superAdmin", true],
    ["another member", "otherMember", false],
    ["a visitor", "visitor", false],
  ] as const)(
    "decides whether %s may have a clean file's derivative",
    async (_, who, allowed) => {
      const { h, fileId, actors } = await world();
      await h.drain();

      const read = h
        .as(actors[who])
        .getFileDerivativeUrl({ fileId, kind: "display_1600" });

      if (allowed) {
        await expect(read).resolves.toMatchObject({ ok: true });
      } else {
        await expect(read).rejects.toMatchObject({ code: "forbidden" });
      }
    }
  );

  it("records each read by staff who don't own the file", async () => {
    const { h, fileId, staffUser, actors } = await world();
    await h.drain();

    await h
      .as(actors.owner)
      .getFileDerivativeUrl({ fileId, kind: "thumb_320" });
    await h
      .as(actors.staffAdmin)
      .getFileDerivativeUrl({ fileId, kind: "thumb_320" });

    expect(await derivativeReads(h)).toEqual([
      expect.objectContaining({
        occurredAt: h.clock.now(),
        actorUserId: staffUser.id,
        actorRole: "staff_admin",
        entityType: "file_asset",
        entityId: fileId,
        before: null,
        after: { kind: "thumb_320" },
      }),
    ]);
  });

  it("refuses everyone a quarantined file's derivative", async () => {
    const { h, fileId, actors } = await world({
      bytes: EICAR_TEST_BYTES,
      contentType: "image/png",
    });
    await h.drain();

    for (const who of ["owner", "staffAdmin", "superAdmin"] as const) {
      expect(
        await h
          .as(actors[who])
          .getFileDerivativeUrl({ fileId, kind: "thumb_320" })
      ).toEqual({ ok: false, error: "file_unavailable" });
    }
    await expect(
      h
        .as(actors.otherMember)
        .getFileDerivativeUrl({ fileId, kind: "thumb_320" })
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses a derivative whose file was processed and then deleted", async () => {
    const { h, fileId, actors } = await world();
    await h.drain();
    await setStatus(h, fileId, "deleted");

    expect(
      await h
        .as(actors.owner)
        .getFileDerivativeUrl({ fileId, kind: "thumb_320" })
    ).toEqual({ ok: false, error: "file_unavailable" });
  });

  it("says the file isn't ready before its scan passes, even to its owner", async () => {
    const { h, fileId, actors } = await world();

    expect(
      await h
        .as(actors.owner)
        .getFileDerivativeUrl({ fileId, kind: "thumb_320" })
    ).toEqual({ ok: false, error: "file_not_ready" });
  });

  it("says the derivative isn't ready while its job is queued or failed", async () => {
    const { h, fileId, actors } = await world();
    h.media.failNext(1);
    await h.drain();

    expect(
      await h
        .as(actors.owner)
        .getFileDerivativeUrl({ fileId, kind: "thumb_320" })
    ).toEqual({ ok: false, error: "derivative_not_ready" });
  });

  it("gives a URL that works for 300 seconds and no longer", async () => {
    const { h, fileId, actors } = await world();
    await h.drain();
    const result = await h
      .as(actors.staffAdmin)
      .getFileDerivativeUrl({ fileId, kind: "display_1600" });
    if (!result.ok) throw new Error(`refused: ${result.error}`);

    h.clock.advance({ seconds: 300 });
    expect((await h.storage.get(result.url)).ok).toBe(true);

    h.clock.advance({ seconds: 1 });
    expect(await h.storage.get(result.url)).toEqual({
      ok: false,
      error: "expired",
    });
  });

  it("tells staff, who may read any file, when there is no such file, and says when the input isn't one", async () => {
    const { h, actors } = await world();

    expect(
      await h.as(actors.staffAdmin).getFileDerivativeUrl({
        fileId: MISSING,
        kind: "thumb_320",
      })
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await h.as(actors.owner).getFileDerivativeUrl({
        fileId: "x",
        kind: "poster" as "thumb_320",
      })
    ).toMatchObject({
      ok: false,
      error: "invalid_input",
      fields: ["fileId", "kind"],
    });
  });

  it("asks the policy before looking: a caller can't tell a missing file from one they may not read", async () => {
    const { h, fileId, actors } = await world();
    await h.drain();

    for (const caller of [actors.otherMember, actors.visitor] as Actor[]) {
      for (const id of [fileId, MISSING]) {
        await expect(
          h.as(caller).getFileDerivativeUrl({ fileId: id, kind: "thumb_320" })
        ).rejects.toMatchObject({ code: "forbidden" });
      }
    }
    // The owner, too, may only find files of their own.
    await expect(
      h
        .as(actors.owner)
        .getFileDerivativeUrl({ fileId: MISSING, kind: "thumb_320" })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
