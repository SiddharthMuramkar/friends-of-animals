import { expect, test, type Page } from "@playwright/test";

import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { recordCspViolations } from "./support/csp";

// #128: a member of the public searches the NGO directory by pin code and
// by their browser's location, narrows it by service and distance, and
// opens a listing. It reads the preview seed (src/server/seed/directory.ts):
// Seed Street Rescues, verified, at 411018 (Pimpri); Seed Paws Trust,
// verified, at 411001 (central Pune), 13.8 km away; and in Nashik, 422001,
// only a pending and a rejected listing. Other journeys add listings at
// 411001, so the checks name the seeded ones rather than count results.

const RESCUER = "Seed Street Rescues";
const NGO = "Seed Paws Trust";

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

const results = (page: Page) =>
  page.getByRole("region", { name: "Results" }).locator("ol > li");

const card = (page: Page, name: string) =>
  page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

test("searches by pin code, service and distance, and opens a listing", async ({
  page,
}) => {
  const violations = await recordCspViolations(page);
  await page.goto("/ngos");
  await expect(
    page.getByRole("heading", { level: 1, name: "Find animal help near you" })
  ).toBeVisible();
  await checkBothThemes(page, "directory search");

  const search = page.getByRole("search", { name: "Search" });
  await search.getByRole("textbox", { name: "Pin code" }).fill("411018");
  await search
    .getByRole("combobox", { name: "Distance" })
    .selectOption({ label: "Within 5 km" });
  await search.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page).toHaveURL(/\/ngos\?pin=411018&service=&radius=5$/);
  await expect(
    page.getByText("1 checked listing within 5 km of 411018 (Pune)")
  ).toBeVisible();
  await expect(results(page)).toHaveCount(1);
  const rescuer = card(page, RESCUER);
  await expect(rescuer.getByText("Less than 1 km away")).toBeVisible();
  await expect(
    rescuer.getByText("Pimpri-Chinchwad, Maharashtra")
  ).toBeVisible();
  await expect(rescuer.getByText("Feeding")).toBeVisible();
  await expect(rescuer.locator('a[href^="tel:+91"]')).toBeVisible();
  await checkBothThemes(page, "directory search results");

  // Wider, and only veterinary care: the NGO in central Pune, not the
  // rescuer, who doesn't offer it.
  await search
    .getByRole("combobox", { name: "Service" })
    .selectOption({ label: "Veterinary care" });
  await search
    .getByRole("combobox", { name: "Distance" })
    .selectOption({ label: "Within 25 km" });
  await search.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/service=veterinary_care&radius=25$/);
  await expect(page.getByText("Offering: Veterinary care")).toBeVisible();
  await expect(card(page, RESCUER)).toHaveCount(0);
  await expect(card(page, NGO).getByText("About 14 km away")).toBeVisible();

  await card(page, NGO).getByRole("link", { name: NGO }).click();
  await expect(page).toHaveURL("/ngos/seed-paws-trust");
  await expect(
    page.getByRole("heading", { level: 1, name: NGO })
  ).toBeVisible();
  expect(violations).toEqual([]);
});

test("searches from the browser's location, the same as from its pin code", async ({
  page,
  context,
}) => {
  const violations = await recordCspViolations(page);
  await page.goto("/ngos?pin=411018&radius=10");
  await expect(card(page, RESCUER)).toBeVisible();
  const byPin = await results(page).allInnerTexts();

  // Pimpri's pin-code centre, to more places than the search keeps.
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 18.63021, longitude: 73.80044 });
  await page.goto("/ngos");
  await page
    .getByRole("combobox", { name: "Distance" })
    .selectOption({ label: "Within 10 km" });
  await page.getByRole("button", { name: "Use my location" }).click();

  // Rounded in the browser: the precise position never reaches FOA.
  await expect(page).toHaveURL("/ngos?lat=18.63&lng=73.80&radius=10");
  await expect(
    page.getByText(/checked listings? within 10 km of your location/)
  ).toBeVisible();
  expect(await results(page).allInnerTexts()).toEqual(byPin);
  await checkBothThemes(page, "directory search from a location");
  expect(violations).toEqual([]);
});

test("explains a bad or unknown pin code and never shows unverified listings", async ({
  page,
}) => {
  await page.goto("/ngos?pin=12");
  const pin = page.getByRole("textbox", { name: "Pin code" });
  await expect(pin).toHaveAccessibleDescription(
    /Enter a six-digit pin code, for example 411001\./
  );
  await expect(pin).toHaveAttribute("aria-invalid", "true");
  await checkBothThemes(page, "directory search with an error");

  await page.goto("/ngos?pin=799999");
  await expect(
    page.getByText(
      "We don't know where this pin code is yet. Try a pin code nearby."
    )
  ).toBeVisible();

  // Nashik has a pending and a rejected listing, nothing verified.
  await page.goto("/ngos?pin=422001&radius=50");
  await expect(
    page.getByText("No checked listings within 50 km of 422001 (Nashik)")
  ).toBeVisible();
  await expect(
    page.getByText("Try a longer distance, or any service.")
  ).toBeVisible();
});
