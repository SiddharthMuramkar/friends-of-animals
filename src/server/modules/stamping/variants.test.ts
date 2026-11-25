import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { fileAsset, fileDerivative } from "../../db/schema";
import { confirmedAdult, submittedImage } from "../entries/testing";
import { entryIdOf } from "../verification/testing";
import { readAll } from "../files/process-image";
import { liveEntryStampSource, queueStamp, stampedImage } from ".";

it("creates distinct idempotent gallery and social derivatives from the safe display copy, with no changes to either input", async () => {
  const h = await createHarness();
  const owner = await confirmedAdult(h);
  const code = await submittedImage(h, owner);
  await h.drain();
  const fileId = await liveEntryStampSource(h.db, await entryIdOf(h, code));
  if (!fileId) throw Error("Missing live entry");
  const [original] = await h.db
    .select()
    .from(fileAsset)
    .where(eq(fileAsset.id, fileId));
  const [display] = await h.db
    .select()
    .from(fileDerivative)
    .where(
      and(
        eq(fileDerivative.fileAssetId, fileId),
        eq(fileDerivative.kind, "display_1600")
      )
    );
  const originalRef = { bucket: original!.bucket, key: original!.storageKey };
  const displayRef = { bucket: display!.bucket, key: display!.storageKey };
  const originalBytes = await readAll(await h.storage.read(originalRef));
  const displayBytes = await readAll(await h.storage.read(displayRef));
  expect(originalBytes).not.toEqual(displayBytes);
  for (const variant of ["gallery", "social"] as const) {
    const input = { fileId, variant };
    expect(await stampedImage(h, input)).toBeNull();
    expect(await h.db.transaction((tx) => queueStamp(tx, h.clock, input))).toBe(
      "queued"
    );
    expect(await h.db.transaction((tx) => queueStamp(tx, h.clock, input))).toBe(
      "queued"
    );
  }
  await h.drain();
  const gallery = await stampedImage(h, { fileId, variant: "gallery" });
  const social = await stampedImage(h, { fileId, variant: "social" });
  expect(gallery).toMatchObject({
    bucket: original!.bucket,
    contentType: "image/webp",
    key: expect.stringContaining("/stamp_gallery_v1.webp"),
  });
  expect(social).toMatchObject({
    bucket: original!.bucket,
    contentType: "image/png",
    key: expect.stringContaining("/stamp_social_v1.png"),
  });
  expect(h.media.stamps).toHaveLength(2);
  expect(h.media.stamps).toEqual(
    expect.arrayContaining([
      { variant: "gallery", bytes: displayBytes },
      { variant: "social", bytes: displayBytes },
    ])
  );
  expect(
    await h.db.transaction((tx) =>
      queueStamp(tx, h.clock, { fileId, variant: "gallery" })
    )
  ).toBe("ready");
  await h.drain();
  expect(h.media.stamps).toHaveLength(2);
  expect(await readAll(await h.storage.read(originalRef))).toEqual(
    originalBytes
  );
  expect(await readAll(await h.storage.read(displayRef))).toEqual(displayBytes);
  expect(
    await h.db.transaction((tx) =>
      queueStamp(tx, h.clock, { fileId, variant: "certificate_share" })
    )
  ).toBe("unavailable");
  await h.db
    .update(fileAsset)
    .set({ status: "deleted" })
    .where(eq(fileAsset.id, fileId));
  expect(await stampedImage(h, { fileId, variant: "gallery" })).toBeNull();
});
