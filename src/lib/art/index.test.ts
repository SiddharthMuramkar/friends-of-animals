import { describe, expect, it, vi } from "vitest";

import { SITE_ART_IDS } from "./art";
import { siteArt } from "./index";

// next's bundler turns each .webp import into StaticImageData; Vite gives a
// URL string, so the generated imports are faked here.
vi.mock("./generated", () => ({
  ART_FILES: new Proxy(
    {},
    {
      get: (_, id) => ({
        src: `/_next/static/media/${String(id)}.0abc.webp`,
        width: 640,
        height: 480,
        blurDataURL: "data:image/webp;base64,UklGRg==",
        blurWidth: 8,
        blurHeight: 6,
      }),
    }
  ),
}));

describe("siteArt", () => {
  it("gives every drawing a plain src without the blur placeholder", () => {
    for (const id of SITE_ART_IDS) {
      const { src, plain } = siteArt(id);
      expect(plain).toStrictEqual({
        src: src.src,
        width: src.width,
        height: src.height,
      });
      expect(src.blurDataURL).toBeDefined();
    }
  });
});
