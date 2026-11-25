import { expect, it } from "vitest";
import { classifyGalleryMedia, srcsetUrls } from "./gallery-media-urls";
const origin = "http://localhost:4103";
it("recognises site media and only the independent stamped gallery route", () => {
  expect(
    classifyGalleryMedia(
      "http://localhost:3000/brand/foa-social-1200x630.png",
      origin
    )
  ).toBe("site");
  expect(
    classifyGalleryMedia(
      "https://outside.example/brand/foa-social-1200x630.png",
      origin
    )
  ).toBe("private");
  expect(
    classifyGalleryMedia(
      "/_next/image?url=%252F_next%252Fstatic%252Fmedia%252Fdog.jpg&w=640&q=75",
      origin
    )
  ).toBe("site");
  expect(
    classifyGalleryMedia(
      "/_next/image?url=%252Fapi%252Ffiles%252Fsecret&w=640&q=75",
      origin
    )
  ).toBe("private");
  expect(
    classifyGalleryMedia(
      "/media/gallery/01938a00-0000-7000-8000-000000103001",
      origin
    )
  ).toBe("stamp");
  expect(
    classifyGalleryMedia(
      "/media/gallery/01938a00-0000-7000-8000-000000103001?X-Amz-Signature=value",
      origin
    )
  ).toBe("private");
  expect(
    classifyGalleryMedia("/media/p/local/entry_image/private", origin)
  ).toBe("private");
  expect(classifyGalleryMedia("/unknown.jpg", origin)).toBe("unknown");
});
it("reads source candidates with width and density descriptors, ignoring inline data", () => {
  expect(srcsetUrls(" /a.webp 480w , /b.webp 800w, /c.webp 2x")).toEqual([
    "/a.webp",
    "/b.webp",
    "/c.webp",
  ]);
  expect(srcsetUrls("data:image/svg+xml,%3Csvg%3E 1x, /b.webp 2x")).toEqual([
    "/b.webp",
  ]);
});
