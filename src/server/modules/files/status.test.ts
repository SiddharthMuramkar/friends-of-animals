import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { fileAsset } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

const PNG = new Uint8Array(68).fill(9);
/** A file id no file has. */
const MISSING = "01938a00-0000-7000-8000-00000000ffff";

/** A pending PNG upload, its owner, and everyone who might ask about it. */
async function world() {
  const h = await createHarness();
  const owner = await h.signIn(await h.seed.member());
  const requested = await h.as(owner).requestUpload({
    purpose: "test_upload",
    contentType: "image/png",
    sizeBytes: PNG.length,
  });
  if (!requested.ok) throw new Error(`refused: ${requested.error}`);
  const staffUser = await h.seed.member({ name: "Meera Staff" });
  await h.seed.grant(staffUser, {
    role: "staff_admin",
    scope: { type: "global" },
  });
  const actors = {
    owner,
    staffAdmin: await h.signIn(staffUser),
    otherMember: await h.signIn(await h.seed.member()),
    visitor: h.visitor(),
  };
  return { h, ...requested, actors };
}

describe("getFileStatus", () => {
  it("follows the owner's file from pending through upload to clean", async () => {
    const { h, fileId, uploadUrl, headers, actors } = await world();
    const status = () => h.as(actors.owner).getFileStatus({ fileId });

    expect(await status()).toEqual({
      ok: true,
      fileId,
      status: "pending_upload",
    });

    await h.storage.put(uploadUrl, PNG, headers);
    await h.as(actors.owner).completeUpload({ fileId });
    expect(await status()).toEqual({ ok: true, fileId, status: "uploaded" });

    // As the scan (63b) leaves it.
    await h.db
      .update(fileAsset)
      .set({ status: "clean" })
      .where(eq(fileAsset.id, fileId));
    expect(await status()).toEqual({ ok: true, fileId, status: "clean" });
  });

  it("tells a staff admin, who may read the file", async () => {
    const { h, fileId, actors } = await world();

    expect(await h.as(actors.staffAdmin).getFileStatus({ fileId })).toEqual({
      ok: true,
      fileId,
      status: "pending_upload",
    });
  });

  it.each(["otherMember", "visitor"] as const)(
    "refuses %s, who may not read the file",
    async (actor) => {
      const { h, fileId, actors } = await world();

      await expect(
        h.as(actors[actor]).getFileStatus({ fileId })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  );

  it("tells staff, who may read any file, that a missing one was not found", async () => {
    const { h, actors } = await world();

    expect(
      await h.as(actors.staffAdmin).getFileStatus({ fileId: MISSING })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it.each(["owner", "otherMember", "visitor"] as const)(
    "refuses %s a missing file as it refuses one they may not read",
    async (actor) => {
      const { h, actors } = await world();

      await expect(
        h.as(actors[actor]).getFileStatus({ fileId: MISSING })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  );

  it("refuses an id that isn't a UUID", async () => {
    const { h, actors } = await world();

    expect(
      await h.as(actors.owner).getFileStatus({ fileId: "../etc" })
    ).toEqual({ ok: false, error: "invalid_input", fields: ["fileId"] });
  });
});
