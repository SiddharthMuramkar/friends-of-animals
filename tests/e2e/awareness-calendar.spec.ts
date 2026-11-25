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

for (const [path, cardId] of [
  ["/awareness", "now"],
  ["/", "home-seasonal"],
] as const) {
  test(`${path} lets visitors browse all twelve illustrated kindness guides`, async ({
    page,
    isMobile,
  }) => {
    await page.goto(path);

    const card = page.locator(`#${cardId}`);
    const currentMonth = monthNames.format(new Date());
    await expect(
      card.getByText("Choose a month", { exact: true })
    ).toBeVisible();
    await expect(card.getByRole("radio")).toHaveCount(12);
    await expect(
      card.getByRole("radio", { name: currentMonth, exact: true })
    ).toBeChecked();

    const artDescriptions = new Set<string | null>();
    for (const [name, title] of guides) {
      const radio = card.getByRole("radio", { name, exact: true });
      if (isMobile) {
        await radio.tap();
      } else {
        await radio.click();
      }

      await expect(radio).toBeChecked();
      await expect(radio.locator("..").locator("svg")).toBeVisible();
      await expect(card.locator("label svg:visible")).toHaveCount(1);
      await expect(card.getByRole("heading", { name: title })).toBeVisible();
      const illustration = card.getByRole("img", { name: /^AI illustration:/ });
      await expect(illustration).toBeVisible();
      artDescriptions.add(await illustration.getAttribute("alt"));
    }
    expect(artDescriptions.size).toBe(12);

    if (!isMobile) {
      await card
        .getByRole("radio", { name: "December", exact: true })
        .press("ArrowRight");
      await expect(
        card.getByRole("radio", { name: "January", exact: true })
      ).toBeChecked();
      await expect(
        card.getByRole("radio", { name: "January", exact: true })
      ).toBeFocused();
    } else {
      await card.getByRole("radio", { name: "January", exact: true }).tap();
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

    await card.getByRole("radio", { name: "November", exact: true }).click();
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
  });
}

test("the homepage calendar fits a compact phone with usable month controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  const card = page.locator("#home-seasonal");
  await expect(card).toBeVisible();
  for (const radio of await card.getByRole("radio").all()) {
    const box = await radio.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(48);
    expect(box?.height).toBeGreaterThanOrEqual(48);
  }
  await expect
    .poll(() => card.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(0);
  await expect(card.getByText("Jan", { exact: true })).toBeVisible();
  await expect(card.getByText("Jun", { exact: true })).toBeVisible();
  await expect(card.getByText("Jul", { exact: true })).toBeVisible();
});

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
