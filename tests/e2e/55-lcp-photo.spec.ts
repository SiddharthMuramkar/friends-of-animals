import { expect, test } from "@playwright/test";

// #55, SPEC §13.2: a public page's one above-the-fold photo is its LCP
// image (#37). It loads eagerly at high fetch priority, React preloads it
// from the <head>, and it gets no blur placeholder, which would paint after
// the photo and become the LCP entry. /contact renders it with LcpPhoto,
// without next/image's client code, which keeps the page under its 170 kB
// JS budget; /about renders it through Photo.

for (const path of ["/contact", "/about"]) {
  test(`${path} loads its LCP photo eagerly, preloaded, with no blur`, async ({
    page,
  }) => {
    await page.goto(path);
    const photo = page.locator("main img[fetchpriority='high']");

    await expect(photo).toHaveCount(1);
    await expect(photo).toHaveAttribute("loading", "eager");
    await expect(photo).toHaveAttribute("srcset", /\/_next\/image\?url=/);
    await expect(photo).not.toHaveAttribute("style", /background-image/);
    const srcset = await photo.getAttribute("srcset");
    const preloaded = await page
      .locator("head link[rel='preload'][as='image']")
      .evaluateAll((links) =>
        links.map((link) => link.getAttribute("imagesrcset"))
      );
    expect(preloaded).toContain(srcset);
    await expect
      .poll(() =>
        photo.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0
        )
      )
      .toBe(true);
  });
}
