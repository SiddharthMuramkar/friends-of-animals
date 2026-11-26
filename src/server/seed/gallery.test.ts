import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { SEED_GALLERY } from "./gallery";
it("seeds a real stamped preview for three fictional artists without re-creating hidden work", async () => {
  const h = await createHarness();
  await h.seed.preview();
  const visitor = h.as(h.visitor());
  const first = await visitor.listPublicGallery();
  expect(first.items.map((i) => i.title)).toEqual(
    expect.arrayContaining([
      "A refuge for birds",
      "A kinder street",
      "Our friends",
    ])
  );
  expect(first.items).toHaveLength(3);
  expect(
    first.items.find((i) => i.title === "A kinder street")?.credit
  ).toEqual({ name: "Rohan D." });
  expect(first.items.every((i) => i.image.sampleIllustration)).toBe(true);
  expect(
    await visitor.readGalleryImage({ itemId: SEED_GALLERY.items[0] })
  ).toMatchObject({ ok: true, contentType: "image/webp" });
  await h.seed.preview();
  expect(await visitor.listPublicGallery()).toEqual(first);
});
