import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/actor";
import { createApp } from "@/server/app";
import { auditLog, fileAsset } from "@/server/db/schema";
import {
  formWorld,
  signInReviewer,
  uploadScan,
} from "@/server/modules/consent-forms/testing";
import { createHarness, type Harness } from "@/test/harness";

import type { FileStatus } from "./domain/file-status";

const PNG = new Uint8Array(1234).fill(7);

/** An uploaded PNG, its owner, and everyone who might ask for it. */
async function world() {
  const h = await createHarness();
  const ownerUser = await h.seed.member();
  const owner = await h.signIn(ownerUser);
  const requested = await h.as(owner).requestUpload({
    purpose: "test_upload",
    contentType: "image/png",
    sizeBytes: PNG.length,
  });
  if (!requested.ok) throw new Error(`refused: ${requested.error}`);
  const { fileId, uploadUrl, headers } = requested;
  await h.storage.put(uploadUrl, PNG, headers);
  const completed = await h.as(owner).completeUpload({ fileId });
  if (!completed.ok) throw new Error(`not completed: ${completed.error}`);

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
  return { h, fileId, ownerUser, staffUser, actors };
}

/** Sets the file's status directly, as the scan (63b) or a delete would. */
async function setStatus(h: Harness, fileId: string, status: FileStatus) {
  await h.db.update(fileAsset).set({ status }).where(eq(fileAsset.id, fileId));
}

/** A file id no file has. */
const MISSING = "01938a00-0000-7000-8000-000000000000";

async function fileReads(h: Harness) {
  return h.db.select().from(auditLog).where(eq(auditLog.action, "file.read"));
}

describe("getFileDownloadUrl", () => {
  it("serves and audits consent-form scans only through the staff role after scanning", async () => {
    const w = await formWorld();
    const { h, school, coordinator } = w;
    const fileId = await uploadScan(w);
    await expect(
      coordinator.getFileDownloadUrl({ fileId })
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    await h.seed.grant(
      { id: school.coordinator.userId },
      { role: "staff_admin", scope: { type: "global" } }
    );
    await h.passSecondFactor(school.coordinator.actor);

    expect(await coordinator.getFileDownloadUrl({ fileId })).toEqual({
      ok: false,
      error: "file_not_ready",
    });
    expect(await fileReads(h)).toEqual([]);
    await setStatus(h, fileId, "clean");

    expect((await coordinator.getFileDownloadUrl({ fileId })).ok).toBe(true);
    expect(await fileReads(h)).toMatchObject([
      {
        actorUserId: school.coordinator.userId,
        actorRole: "staff_admin",
        entityId: fileId,
      },
    ]);
  });

  it("keeps clean consent-form scans unavailable in the production configuration", async () => {
    const w = await formWorld();
    const { h } = w;
    const fileId = await uploadScan(w);
    await setStatus(h, fileId, "clean");
    const { actor } = await signInReviewer(h);
    const staff = createApp({
      ...h.deps,
      files: { ...h.deps.files, appEnv: "production" },
    }).as(actor);
    const sign = vi
      .spyOn(h.storage, "presignGet")
      .mockRejectedValue(
        new Error("Dormant consent-form delivery reached the storage signer")
      );

    expect(await staff.getFileDownloadUrl({ fileId })).toEqual({
      ok: false,
      error: "file_unavailable",
    });
    expect(sign).not.toHaveBeenCalled();
    expect(await fileReads(h)).toEqual([]);
  });

  it("gives the owner a URL that serves the uploaded bytes", async () => {
    const { h, fileId, actors } = await world();
    await setStatus(h, fileId, "clean");

    const result = await h.as(actors.owner).getFileDownloadUrl({ fileId });

    if (!result.ok) throw new Error(`refused: ${result.error}`);
    expect(result.expiresAt).toEqual(
      new Date(h.clock.now().getTime() + 300 * 1000)
    );
    expect(await h.storage.get(result.url)).toEqual({
      ok: true,
      bytes: PNG,
      contentType: "image/png",
      contentDisposition: `inline; filename="test_upload-${fileId.slice(0, 8)}.png"`,
      cacheControl: "private, no-store",
    });
    // The owner reading their own file is not audited.
    expect(await fileReads(h)).toEqual([]);
  });

  it.each([
    ["the owner", "allowed", "owner"],
    ["a staff admin", "allowed", "staffAdmin"],
    ["a super admin", "allowed", "superAdmin"],
    ["another member", "forbidden", "otherMember"],
    ["a visitor", "forbidden", "visitor"],
  ] as const)("lets %s have a clean file: %s", async (_who, outcome, actor) => {
    const { h, fileId, actors } = await world();
    await setStatus(h, fileId, "clean");

    const read = h.as(actors[actor]).getFileDownloadUrl({ fileId });

    if (outcome === "allowed") {
      expect(await read).toMatchObject({ ok: true });
    } else {
      await expect(read).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("records each read by staff who don't own the file", async () => {
    const { h, fileId, staffUser, actors } = await world();
    await setStatus(h, fileId, "clean");

    await h.as(actors.staffAdmin).getFileDownloadUrl({ fileId });

    expect(await fileReads(h)).toEqual([
      expect.objectContaining({
        occurredAt: h.clock.now(),
        actorKind: "user",
        actorUserId: staffUser.id,
        actorRole: "staff_admin",
        entityType: "file_asset",
        entityId: fileId,
        before: null,
        after: null,
      }),
    ]);
  });

  it("records no read for a request it refuses", async () => {
    const { h, fileId, actors } = await world();

    expect(
      await h.as(actors.staffAdmin).getFileDownloadUrl({ fileId })
    ).toEqual({ ok: false, error: "file_not_ready" });
    await expect(
      h.as(actors.otherMember).getFileDownloadUrl({ fileId })
    ).rejects.toMatchObject({ code: "forbidden" });

    expect(await fileReads(h)).toEqual([]);
  });

  // Who gets a URL at each status, among callers the policy allows. A
  // caller it refuses is forbidden whatever the status.
  const gate: [
    FileStatus,
    Record<"owner" | "staffAdmin" | "superAdmin", string>,
  ][] = [
    [
      "pending_upload",
      {
        owner: "file_not_ready",
        staffAdmin: "file_not_ready",
        superAdmin: "file_not_ready",
      },
    ],
    [
      "uploaded",
      {
        owner: "url",
        staffAdmin: "file_not_ready",
        superAdmin: "file_not_ready",
      },
    ],
    [
      "scanning",
      {
        owner: "url",
        staffAdmin: "file_not_ready",
        superAdmin: "file_not_ready",
      },
    ],
    ["clean", { owner: "url", staffAdmin: "url", superAdmin: "url" }],
    [
      "quarantined",
      {
        owner: "file_unavailable",
        staffAdmin: "file_unavailable",
        superAdmin: "file_unavailable",
      },
    ],
    [
      "rejected",
      {
        owner: "file_unavailable",
        staffAdmin: "file_unavailable",
        superAdmin: "file_unavailable",
      },
    ],
    [
      "deleted",
      {
        owner: "file_unavailable",
        staffAdmin: "file_unavailable",
        superAdmin: "file_unavailable",
      },
    ],
  ];

  it.each(gate)("gates a file that is %s", async (status, expected) => {
    const { h, fileId, actors } = await world();
    await setStatus(h, fileId, status);

    for (const [who, outcome] of Object.entries(expected)) {
      const result = await h
        .as(actors[who as keyof typeof expected])
        .getFileDownloadUrl({ fileId });
      expect({ who, result }).toEqual({
        who,
        result:
          outcome === "url"
            ? expect.objectContaining({ ok: true })
            : { ok: false, error: outcome },
      });
    }
    for (const refused of [actors.otherMember, actors.visitor] as Actor[]) {
      await expect(
        h.as(refused).getFileDownloadUrl({ fileId })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("gives a URL that works for 300 seconds and no longer", async () => {
    const { h, fileId, actors } = await world();
    await setStatus(h, fileId, "clean");
    const result = await h.as(actors.owner).getFileDownloadUrl({ fileId });
    if (!result.ok) throw new Error(`refused: ${result.error}`);

    h.clock.advance({ seconds: 299 });
    expect((await h.storage.get(result.url)).ok).toBe(true);

    h.clock.advance({ seconds: 1, milliseconds: 1 });
    expect(await h.storage.get(result.url)).toEqual({
      ok: false,
      error: "expired",
    });
  });

  it("tells staff, who may read any file, when there is no such file", async () => {
    const { h, actors } = await world();

    expect(
      await h.as(actors.staffAdmin).getFileDownloadUrl({ fileId: MISSING })
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await h.as(actors.owner).getFileDownloadUrl({ fileId: "x" })
    ).toMatchObject({ ok: false, error: "invalid_input", fields: ["fileId"] });
  });

  it("asks the policy before looking: a caller can't tell a missing file from one they may not read", async () => {
    const { h, fileId, actors } = await world();
    await setStatus(h, fileId, "clean");

    for (const caller of [actors.otherMember, actors.visitor] as Actor[]) {
      for (const id of [fileId, MISSING]) {
        await expect(
          h.as(caller).getFileDownloadUrl({ fileId: id })
        ).rejects.toMatchObject({ code: "forbidden" });
      }
    }
    // The owner, too, may only find files of their own.
    await expect(
      h.as(actors.owner).getFileDownloadUrl({ fileId: MISSING })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
