import { expect, type Page, test } from "@playwright/test";

async function expectPageToFit(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const { clientWidth, scrollWidth } = await page.evaluate(() => {
    const { clientWidth, scrollWidth } = document.documentElement;
    return { clientWidth, scrollWidth };
  });
  expect(scrollWidth, new URL(page.url()).pathname).toBe(clientWidth);
}

async function enlargeText(page: Page) {
  const root = page.locator("html");
  await expect(root).toHaveAttribute("style", /--header-height:/);
  await root.evaluate((element) => {
    element.style.fontSize = "200%";
  });
  await expect(root).toHaveCSS("font-size", "32px");
}

for (const width of [390, 768, 1440]) {
  test(`public pages fit a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/competitions", "/awareness", "/sign-in/phone"]) {
      const response = await page.goto(path);
      expect(response?.ok(), path).toBe(true);
      await expectPageToFit(page);
    }
  });
}

test("credits and footer links fit a compact phone with enlarged text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/credits");
  await enlargeText(page);
  await expectPageToFit(page);

  const credit = page.getByRole("main").getByRole("article").first();
  const title = credit.getByRole("heading", { level: 3 });
  const thumbnail = credit.getByRole("img");
  await expect(title).toBeVisible();
  await expect(thumbnail).toBeVisible();
  const [titleBox, thumbnailBox] = await Promise.all([
    title.boundingBox(),
    thumbnail.boundingBox(),
  ]);
  expect(titleBox!.y).toBeGreaterThanOrEqual(
    thumbnailBox!.y + thumbnailBox!.height
  );

  const address = page.getByRole("link", { name: "cybercrime.gov.in" });
  await address.scrollIntoViewIfNeeded();
  await expect(address).toBeInViewport({ ratio: 1 });
});

test("public content reflows on a compact phone with enlarged text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const path of ["/", "/awareness", "/schools", "/privacy"]) {
    const response = await page.goto(path);
    expect(response?.ok(), path).toBe(true);
    await enlargeText(page);
    await expectPageToFit(page);
  }
});

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

test("the homepage hero keeps its action while the streamed parts reveal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  // React reveals the streamed parts of the page on a timer after the first
  // paint. A paused clock holds them back, so the action first painted can be
  // held before any of them replace what the static shell showed.
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 60_000);
  const streamed = page.locator('div[hidden][id^="S:"]');
  const action = page
    .getByRole("main")
    .getByRole("link", { name: "See the competitions", exact: true });

  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const painted = await action.elementHandle();
    await page.clock.runFor(1_000);
    await expect(streamed).toHaveCount(0);
    // A visitor tapping the action as the page settles must hit the same
    // link, still full size: never one torn out for a copy streamed later.
    expect(
      await action.evaluate((link, first) => link === first, painted)
    ).toBe(true);
    expect(
      await painted!.evaluate((link) => link.getBoundingClientRect().height)
    ).toBeGreaterThanOrEqual(44);
  } finally {
    await page.clock.resume();
  }
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

test("resizing an open menu hands focus to the desktop navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1023, height: 800 });
  await page.goto("/about");
  await expect(page.locator("html")).toHaveAttribute(
    "style",
    /--header-height:/
  );

  const header = page.getByRole("banner");
  const trigger = header.getByRole("button", { name: "Menu", exact: true });
  const menu = page.getByRole("dialog", { name: "Pages" });
  await trigger.click();
  await expect(menu).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(menu).toBeHidden();
  const desktopNav = header.getByRole("navigation", { name: "Main" });
  await expect(desktopNav.getByRole("link", { name: "About" })).toBeFocused();
  await expectPageToFit(page);
  await desktopNav.getByRole("link", { name: "Schools" }).click();
  await expect(page).toHaveURL(/\/schools$/);

  await page.setViewportSize({ width: 844, height: 320 });
  await trigger.click();
  await expect(menu).toBeVisible();
});

test("the menu remains usable when short and text is enlarged", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 320 });
  await page.goto("/");
  await enlargeText(page);

  const trigger = page.getByRole("button", { name: "Menu", exact: true });
  expect((await trigger.boundingBox())?.width).toBeGreaterThanOrEqual(44);
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Pages" });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((el) => el.scrollWidth)).toBe(
    await menu.evaluate((el) => el.clientWidth)
  );

  for (const control of [
    menu.getByRole("link", { name: "About" }),
    menu.getByRole("link", { name: "Donate" }),
    menu.getByRole("button", { name: "Close menu" }),
  ]) {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport({ ratio: 1 });
    expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});
