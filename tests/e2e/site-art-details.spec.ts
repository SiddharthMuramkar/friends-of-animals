import { expect, test } from "@playwright/test";

// The decorative animals should add a small detail without hiding content,
// changing the page's accessible name, or causing overflow on a small phone.
const DETAILS = [
  { path: "/", id: "sticker-palm-squirrel", heading: "#home-how", max: 96 },
  {
    path: "/schools",
    id: "sticker-common-myna",
    heading: "#schools-steps",
    max: 88,
  },
  {
    path: "/adopt",
    id: "sticker-adoption-friends",
    heading: "main h1",
    max: 112,
  },
];

for (const detail of DETAILS) {
  test(`${detail.path} shows its decorative animal without covering the heading`, async ({
    page,
  }) => {
    const response = await page.goto(detail.path);
    expect(response?.ok()).toBe(true);
    const art = page.locator(`main img[src*="${detail.id}"]`);
    const heading = page.locator(detail.heading);
    await expect(art).toHaveCount(1);
    await expect(art).toHaveAttribute("alt", "");
    await art.scrollIntoViewIfNeeded();
    await expect
      .poll(() => art.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);

    // Check the normal viewport and then compact reflow with enlarged text.
    for (const enlarged of [false, true]) {
      if (enlarged) {
        await page.setViewportSize({ width: 320, height: 568 });
        await page.locator("html").evaluate((el) => {
          el.style.fontSize = "200%";
        });
      }
      await expect(heading).toBeVisible();
      await expect(art).toBeVisible();
      const [artBox, headingBox] = await Promise.all([
        art.boundingBox(),
        heading.boundingBox(),
      ]);
      expect(artBox!.width).toBeLessThanOrEqual(detail.max);
      expect(artBox!.x).toBeGreaterThanOrEqual(0);
      expect(artBox!.x + artBox!.width).toBeLessThanOrEqual(
        await page.evaluate(() => document.documentElement.clientWidth)
      );
      expect(
        headingBox!.x + headingBox!.width <= artBox!.x ||
          headingBox!.y + headingBox!.height <= artBox!.y
      ).toBe(true);
    }
  });
}

test("the three new decorative illustrations are credited", async ({
  page,
}) => {
  await page.goto("/credits");
  const stickers = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: /Doodle stickers/ }),
  });
  await stickers.getByText("What we asked for", { exact: true }).click();
  for (const name of [
    "Palm squirrel",
    "Common myna",
    "Indie puppy and kitten",
  ]) {
    await expect(stickers.getByText(name, { exact: true })).toBeVisible();
  }
});
