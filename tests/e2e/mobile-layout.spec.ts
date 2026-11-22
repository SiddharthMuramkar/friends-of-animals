import { expect, test } from "@playwright/test";

test("the homepage competition action fits on a compact phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const action = page
    .getByRole("main")
    .getByRole("link", { name: "See the competitions", exact: true });
  await expect(action).toBeVisible();
  const { top, bottom, left, right, height } = await action.evaluate((link) => {
    const { top, bottom, left, right, height } = link.getBoundingClientRect();
    return { top, bottom, left, right, height };
  });
  // The sample registration announcement adds height only on test sites.
  const announcement = page.getByRole("complementary", {
    name: "See the competition",
    exact: true,
  });
  const announcementHeight = (await announcement.count())
    ? ((await announcement.boundingBox())?.height ?? 0)
    : 0;
  expect(top).toBeGreaterThanOrEqual(0);
  expect(bottom - announcementHeight).toBeLessThanOrEqual(568);
  expect(left).toBeGreaterThanOrEqual(0);
  expect(right).toBeLessThanOrEqual(320);
  expect(height).toBeGreaterThanOrEqual(44);
  const { clientWidth, scrollWidth } = await page.evaluate(() => {
    const { clientWidth, scrollWidth } = document.documentElement;
    return { clientWidth, scrollWidth };
  });
  expect(clientWidth).toBe(320);
  expect(scrollWidth).toBe(clientWidth);
});

test("the landscape menu stays open through hydration, scrolls, and closes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 320 });
  const scripts = Promise.withResolvers<void>();
  await page.route("**/_next/static/chunks/*.js", async (route) => {
    await scripts.promise;
    await route.continue();
  });

  const trigger = page.getByRole("button", { name: "Menu", exact: true });
  const menu = page.getByRole("dialog", { name: "Pages" });
  const nav = menu.getByRole("navigation", { name: "Main" });
  const about = nav.getByRole("link", { name: "About", exact: true });
  const close = menu.getByRole("button", { name: "Close menu" });

  // React reveals the streamed parts of the page on a timer after the first
  // paint. A paused clock holds them back, so the tap always lands first.
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 60_000);
  const streamed = page.locator('div[hidden][id^="S:"]');

  try {
    // The native button works while the mobile connection loads the scripts.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(streamed).not.toHaveCount(0);
    await trigger.click();
    await expect(menu).toBeVisible();
    // Revealing the streamed content must not close or replace the menu.
    await page.clock.runFor(1_000);
    await expect(streamed).toHaveCount(0);
    await expect(menu).toBeVisible();
  } finally {
    await page.clock.resume();
    scripts.resolve();
  }
  // HeaderHeightSync writes the measured height after hydration.
  await expect(page.locator("html")).toHaveAttribute(
    "style",
    /--header-height:/
  );
  await expect(menu).toBeVisible();
  await expect(close).toBeInViewport({ ratio: 1 });
  await expect(menu.getByRole("link", { name: "Donate" })).toBeInViewport({
    ratio: 1,
  });
  await about.scrollIntoViewIfNeeded();
  await expect(about).toBeInViewport({ ratio: 1 });
  expect(await nav.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await trigger.click();
  await close.click();
  await expect(menu).toBeHidden();

  await trigger.click();
  await about.click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(menu).toBeHidden();
});
