import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 640, height: 320 } });

test("a story source note can be read and closed in phone landscape", async ({
  page,
}) => {
  await page.goto("/blog/rukmini-devi-and-indias-animal-law");
  await page.evaluate(() => document.fonts.ready);
  const source = page
    .getByRole("button", { name: "Source 2", exact: true })
    .first();
  await source.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await source.click();

  const note = page.locator("main :popover-open");
  await expect(note).toBeInViewport({ ratio: 1 });
  const centreOffset = await note.evaluate((element) => {
    const { left, right, top, bottom } = element.getBoundingClientRect();
    return Math.max(
      Math.abs((left + right - window.innerWidth) / 2),
      Math.abs((top + bottom - window.innerHeight) / 2)
    );
  });
  expect(centreOffset).toBeLessThan(2);
  const close = note.getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeInViewport({ ratio: 1 });
  await close.click();
  await expect(note).toHaveCount(0);
});
