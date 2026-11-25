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

test("lets visitors browse all twelve illustrated kindness guides", async ({
  page,
  isMobile,
}) => {
  await page.goto("/awareness");

  const section = page.locator("#month");
  const card = section.getByRole("article");
  const currentMonth = monthNames.format(new Date());
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
