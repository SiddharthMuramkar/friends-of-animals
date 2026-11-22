// The upload island's server steps (#63) at Seam 1: what each Server Action
// answers, through the real use cases. A refusal, or an error a use case
// throws on purpose, comes back as an UploadError; it never rejects, which
// would send the island to the error boundary.

import { describe, expect, it } from "vitest";

import { createApp } from "@/server/app";
import { unconfiguredStorage } from "@/server/ports/storage";
import { createHarness, type Harness } from "@/test/harness";

import {
  completeUploadStep,
  fileStatusStep,
  requestUploadStep,
} from "./upload-steps";

const MiB = 1024 * 1024;
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);
const pngUpload = { contentType: "image/png", sizeBytes: PNG.length };

async function world() {
  const h = await createHarness();
  const member = await h.signIn(await h.seed.member());
  return { h, member };
}

/**
 * The app on a deployment that has no object storage configured yet: its
 * storage refuses every call (src/server/ports/storage.ts).
 */
function withoutStorage(h: Harness) {
  return createApp({
    ...h.deps,
    storage: unconfiguredStorage,
    files: { ...h.deps.files, appEnv: "preview" },
  });
}

/** The member's PNG, presigned and PUT, but not completed. */
async function stored(
  h: Harness,
  member: Awaited<ReturnType<Harness["signIn"]>>
) {
  const requested = await requestUploadStep(h.as(member), pngUpload);
  if (!requested.ok) throw new Error(`refused: ${requested.error}`);
  const put = await h.storage.put(requested.uploadUrl, PNG, requested.headers);
  if (!put.ok) throw new Error(`not stored: ${put.error}`);
  return requested.fileId;
}

describe("requestUploadStep", () => {
  it("presigns a member's test upload", async () => {
    const { h, member } = await world();

    expect(await requestUploadStep(h.as(member), pngUpload)).toEqual({
      ok: true,
      fileId: expect.any(String),
      uploadUrl: expect.stringMatching(/^https:\/\/storage\.fake\.test\//),
      headers: { "Content-Type": "image/png" },
    });
  });

  it.each([
    ["too_large", { sizeBytes: 10 * MiB + 1 }],
    ["empty", { sizeBytes: 0 }],
    ["type_not_allowed", { contentType: "text/html" }],
  ])("answers the server's refusal: %s", async (error, change) => {
    const { h, member } = await world();

    expect(
      await requestUploadStep(h.as(member), { ...pngUpload, ...change })
    ).toEqual({ ok: false, error });
  });

  it("answers unknown for input that isn't an upload", async () => {
    const { h, member } = await world();

    expect(
      await requestUploadStep(h.as(member), { contentType: 5, sizeBytes: -1 })
    ).toEqual({ ok: false, error: "unknown" });
  });

  it("says uploads are unavailable where no storage is configured", async () => {
    const { h, member } = await world();

    expect(
      await requestUploadStep(withoutStorage(h).as(member), pngUpload)
    ).toEqual({ ok: false, error: "storage_unavailable" });
  });

  it("answers unknown when the use case refuses the caller", async () => {
    const { h } = await world();

    expect(await requestUploadStep(h.as(h.visitor()), pngUpload)).toEqual({
      ok: false,
      error: "unknown",
    });
  });
});

describe("completeUploadStep", () => {
  it("confirms the uploader's stored file", async () => {
    const { h, member } = await world();
    const fileId = await stored(h, member);

    expect(await completeUploadStep(h.as(member), fileId)).toEqual({
      ok: true,
      status: "uploaded",
    });
  });

  it("says the upload is missing before the PUT has arrived", async () => {
    const { h, member } = await world();
    const requested = await requestUploadStep(h.as(member), pngUpload);
    if (!requested.ok) throw new Error(`refused: ${requested.error}`);

    expect(await completeUploadStep(h.as(member), requested.fileId)).toEqual({
      ok: false,
      error: "upload_missing",
    });
  });

  it("answers unknown for another member's file, or an id that isn't one", async () => {
    const { h, member } = await world();
    const fileId = await stored(h, member);
    const other = await h.signIn(await h.seed.member());

    expect(await completeUploadStep(h.as(other), fileId)).toEqual({
      ok: false,
      error: "unknown",
    });
    expect(await completeUploadStep(h.as(member), "../etc")).toEqual({
      ok: false,
      error: "unknown",
    });
  });

  it("says uploads are unavailable where no storage is configured", async () => {
    const { h, member } = await world();
    const fileId = await stored(h, member);

    expect(
      await completeUploadStep(withoutStorage(h).as(member), fileId)
    ).toEqual({ ok: false, error: "storage_unavailable" });
  });
});

describe("fileStatusStep", () => {
  it("tells the uploader where the scan has got to", async () => {
    const { h, member } = await world();
    const fileId = await stored(h, member);
    await completeUploadStep(h.as(member), fileId);

    expect(await fileStatusStep(h.as(member), fileId)).toEqual({
      ok: true,
      status: "uploaded",
    });
    await h.drain();
    expect(await fileStatusStep(h.as(member), fileId)).toEqual({
      ok: true,
      status: "clean",
    });
  });

  it("answers unknown for another member's file, or no such file", async () => {
    const { h, member } = await world();
    const fileId = await stored(h, member);
    const other = await h.signIn(await h.seed.member());

    expect(await fileStatusStep(h.as(other), fileId)).toEqual({
      ok: false,
      error: "unknown",
    });
    expect(
      await fileStatusStep(h.as(member), "01938a00-0000-7000-8000-000000000000")
    ).toEqual({ ok: false, error: "unknown" });
  });
});
