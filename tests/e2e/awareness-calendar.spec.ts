import { expect, test } from "@playwright/test";

const guides = [
  ["January", "Kite season: plain cotton thread only"],
  ["February", "Be a bird counter"],
  ["March", "Water bowls: change daily, scrub weekly"],
  ["April", "Shade, water and a noon break"],
  ["May", "Hot ground, hot cars"],
  ["June", "Rain: knock, look, then drive"],
  ["July", "Plant a tree for birds"],
  ["August", "Kites around Independence Day"],
  ["September", "World Rabies Day: what to do if bitten"],
  ["October", "Wildlife Week and quieter celebrations"],
  ["November", "Puppy season: give mothers space"],
  ["December", "Cold nights: warm beds, never fires"],
];

const monthNames = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  timeZone: "Asia/Kolkata",
});

for (const [path, id] of [
  ["/awareness", "now"],
  ["/", "home-seasonal"],
] as const) {
  test(`${path} lets visitors browse all twelve illustrated kindness guides`, async ({
    page,
    isMobile,
  }) => {
    await page.goto(path);

    const card = page.locator(`article#${id}`);
    const picker = card.getByRole("group", { name: "Choose a month" });
    const currentMonth = monthNames.format(new Date());
    await expect(
      card.getByText("Choose a month", { exact: true })
    ).toBeVisible();
    await expect(picker.getByRole("radio")).toHaveCount(12);
    await expect(
      picker.getByRole("radio", { name: currentMonth, exact: true })
    ).toBeChecked();

    if (path === "/") {
      // The seed card in the streamed shell must be replaced, not leave a
      // second group of radios able to uncheck the live group's selection.
      await expect(
        page.locator('input[name="home-seasonal-months"]')
      ).toHaveCount(12);
      await expect(page.locator('[id^="home-seasonal-fallback-"]')).toHaveCount(
        0
      );
    }

    const artDescriptions = new Set<string | null>();
    for (const [name, title] of guides) {
      const radio = picker.getByRole("radio", { name, exact: true });
      if (isMobile) {
        await radio.tap();
      } else {
        await radio.click();
      }

      await expect(radio).toBeChecked();
      await expect(picker.getByRole("radio", { checked: true })).toHaveCount(1);
      await expect(radio.locator("..").locator("svg")).toBeVisible();
      await expect(picker.locator("label svg:visible")).toHaveCount(1);
      await expect(card.getByRole("heading", { name: title })).toBeVisible();
      await expect(
        card.getByText(
          name === currentMonth
            ? `This month’s kindness · ${name}`
            : `Kindness for ${name}`,
          { exact: true }
        )
      ).toBeVisible();
      const illustration = card.getByRole("img", { name: /^AI illustration:/ });
      await expect(illustration).toBeVisible();
      artDescriptions.add(await illustration.getAttribute("alt"));
    }
    expect(artDescriptions.size).toBe(12);

    const january = picker.getByRole("radio", { name: "January", exact: true });
    if (!isMobile) {
      await picker
        .getByRole("radio", { name: "December", exact: true })
        .press("ArrowRight");
      await expect(january).toBeChecked();
      await expect(january).toBeFocused();
    } else {
      await january.tap();
    }
    await expect(
      card.getByRole("heading", { name: /Kite season/ })
    ).toBeVisible();
    await card.getByText("For grown-ups", { exact: true }).click();
    await expect(
      card.getByRole("link", {
        name: "AWBI letter on harmful kite threads, 11 Jan 2026",
      })
    ).toBeVisible();

    await picker.getByRole("radio", { name: "November", exact: true }).click();
    await expect(
      card.getByRole("heading", { name: /Puppy season/ })
    ).toBeVisible();
    await expect(
      card.getByText("Do not touch the puppies or go near them.")
    ).toBeVisible();
    await expect(
      card.getByRole("link", { name: /AWBI letter on harmful kite threads/ })
    ).toHaveCount(0);
    if (path === "/") {
      await expect(
        page.getByRole("link", { name: "More ways to help animals" })
      ).toHaveAttribute("href", "/awareness");
    }

    // Browser-local selection does not persist: new visitors and a fresh
    // page load always start on the current month in India.
    await page.reload();
    await expect(
      picker.getByRole("radio", { name: currentMonth, exact: true })
    ).toBeChecked();
    await expect(picker.getByRole("radio", { checked: true })).toHaveCount(1);
  });

  test(`${path} kindness calendar fits a compact phone with usable month controls`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(path);
    const card = page.locator(`article#${id}`);
    const picker = card.getByRole("group", { name: "Choose a month" });
    await expect(picker.getByRole("radio")).toHaveCount(12);
    for (const radio of await picker.getByRole("radio").all()) {
      const box = await radio.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(48);
      expect(box?.height).toBeGreaterThanOrEqual(48);
    }
    await expect
      .poll(() => card.evaluate((el) => el.scrollWidth - el.clientWidth))
      .toBeLessThanOrEqual(0);

    // Unlike single-letter tiles, the displayed abbreviations are distinct.
    for (const name of ["Jan", "Jun", "Jul"]) {
      await expect(picker.getByText(name, { exact: true })).toBeVisible();
    }
    await picker.getByRole("radio", { name: "July", exact: true }).click();
    await expect(
      card.getByRole("heading", { name: "Plant a tree for birds" })
    ).toBeVisible();
  });

  test(`${path} keeps a month picked before hydration`, async ({
    page,
    isMobile,
  }) => {
    const scripts = Promise.withResolvers<void>();
    await page.route("**/_next/static/chunks/*.js", async (route) => {
      await scripts.promise;
      await route.continue();
    });
    const card = page.locator(`article#${id}`);
    const currentMonth = monthNames.format(new Date());
    const [name, title] = guides.find(([month]) => month !== currentMonth)!;
    const picked = card.getByRole("radio", { name, exact: true });
    try {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(
        card.getByRole("radio", { name: currentMonth, exact: true })
      ).toBeChecked();
      // The browser can select a native radio before React handles changes.
      if (isMobile) await picked.tap();
      else await picked.click();
      await expect(picked).toBeChecked();
      await expect(card.getByRole("heading", { name: title })).toHaveCount(0);
    } finally {
      scripts.resolve();
    }
    await expect(card.getByRole("heading", { name: title })).toBeVisible();
    await expect(picked).toBeChecked();
    await expect(card.getByRole("radio", { checked: true })).toHaveCount(1);
  });
}

test("home gallery identifies each of its four illustrated prompts", async ({
  page,
}) => {
  await page.goto("/");
  const gallery = page
    .locator("section")
    .filter({ has: page.locator("#home-gallery") });
  const frames = gallery
    .locator("figure")
    .filter({ has: page.getByText("AI illustration", { exact: true }) });
  await expect(frames).toHaveCount(4);

  for (const caption of [
    "Your drawing could hang here",
    "A painting of your street’s cat?",
    "Your best bird photo",
    "Something you made by hand",
  ]) {
    const frame = frames.filter({ hasText: caption });
    await expect(
      frame.getByRole("img", { name: /^AI illustration:/ })
    ).toBeVisible();
    await expect(
      frame.getByText("AI illustration", { exact: true })
    ).toBeVisible();
  }
});
