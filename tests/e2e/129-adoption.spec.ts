import { readFileSync } from "node:fs";

import { expect, type Page } from "@playwright/test";

import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { recordCspViolations } from "./support/csp";
import { test } from "./support/seed-adoption";
import { signInByCode } from "./support/sign-in";

// #129: a visitor browses and filters adoptable animals on /adopt and opens
// one; a verified listing's representative adds an animal (fixing a
// refused answer), uploads a photo, publishes a ready draft, holds, edits
// and withdraws it. Every adoption page shows the FOA-facilitates
// disclaimer, every new page is checked with axe in light and dark, and no
// page breaks the Content Security Policy.
//
// The browse journey reads the preview seed (src/server/seed/adoption.ts)
// and changes nothing. The representative's journey seeds its own listing
// (./support/seed-adoption.ts), so the tests run in parallel on both
// projects against one database.

const DISCLAIMER =
  "Friends of Animals facilitates adoption. The organisation that lists an animal is responsible for it";

async function checkPage(page: Page, label: string) {
  await expect(page.getByTestId("adoption-disclaimer")).toContainText(
    DISCLAIMER
  );
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

const JPEG = readFileSync(
  new URL("../../fixtures/media/gps.jpg", import.meta.url)
);

test("a visitor filters adoptable animals and opens one's page", async ({
  page,
}) => {
  const violations = await recordCspViolations(page);
  await page.goto("/adopt");
  const results = page.getByRole("region", { name: "Animals for adoption" });
  await expect(
    results.getByRole("link", { name: "Seed Bruno", exact: true })
  ).toBeVisible();
  await checkPage(page, "/adopt");

  await page.getByLabel("Animal", { exact: true }).selectOption("cat");
  await page.getByRole("button", { name: "Show animals" }).click();
  await expect(page).toHaveURL(/\/adopt\?species=cat(&|$)/);
  await expect(
    results.getByRole("link", { name: "Seed Rani", exact: true })
  ).toBeVisible();
  await expect(
    results.getByRole("link", { name: "Seed Mithu", exact: true })
  ).toBeVisible();
  await expect(
    results.getByRole("link", { name: "Seed Bruno", exact: true })
  ).toHaveCount(0);
  await checkPage(page, "/adopt?species=cat");

  await page.goto("/adopt");
  await results.getByRole("link", { name: "Seed Bruno", exact: true }).click();
  await expect(page).toHaveURL("/adopt/seed-bruno-dog-pune");
  await expect(
    page.getByRole("heading", { name: "Seed Bruno", level: 1 })
  ).toBeVisible();
  await expect(
    page.getByText("A home visit before the adoption")
  ).toBeVisible();
  // The photo is a resized copy from the same origin, and it loads.
  const photo = page.getByRole("img", { name: /Seed Bruno, a dog/ });
  await expect(photo).toHaveAttribute(
    "src",
    /^\/media\/adoption\/[0-9a-f-]{36}\/thumb_320$/
  );
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await checkPage(page, "/adopt/[slug]");

  await page.goto("/adopt/seed-sheru-dog-pune");
  await expect(
    page.getByText("On hold: an adoption is being discussed")
  ).toBeVisible();
  expect(violations).toEqual([]);
});

test("hidden and unknown animals are the 404", async ({ page }) => {
  // Published, but its foster home is suspended.
  expect((await page.goto("/adopt/seed-tara-dog-satara"))?.status()).toBe(404);
  // A draft.
  expect((await page.goto("/adopt/seed-chutki-cat-pune"))?.status()).toBe(404);
  expect((await page.goto("/adopt/no-such-animal-here"))?.status()).toBe(404);
});

test("a representative adds an animal and a photo, then publishes, holds, edits and withdraws one", async ({
  page,
  request,
  seedAdoptionWorld,
}) => {
  const world = await seedAdoptionWorld();
  const violations = await recordCspViolations(page);
  await signInByCode(page, request, world.ownerEmail);
  const base = `/organisation/${world.listingId}/adoptions`;

  await page.goto(`/organisation/${world.listingId}`);
  await page.getByRole("link", { name: "Manage animals" }).click();
  await expect(page).toHaveURL(base);
  await expect(
    page.getByRole("link", { name: world.draft.name })
  ).toBeVisible();
  await checkPage(page, "/organisation/[id]/adoptions");

  // Add an animal, fixing a refused answer.
  await page.getByRole("link", { name: "Add an animal" }).click();
  await expect(page).toHaveURL(`${base}/new`);
  await checkPage(page, "/organisation/[id]/adoptions/new");
  const field = (label: string) => page.getByLabel(label, { exact: true });
  await field("Name").fill("Laddoo");
  await field("Animal").selectOption("cat");
  await field("Sex").selectOption("female");
  await field("Years").fill("1");
  await field("Adoption conditions").fill("");
  await page.getByRole("button", { name: "Save the draft" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Some answers need fixing"
  );
  await expect(field("Adoption conditions")).toHaveAttribute(
    "aria-invalid",
    "true"
  );
  await field("Adoption conditions").fill("An indoor home only.");
  await page.getByRole("button", { name: "Save the draft" }).click();
  await expect(page).toHaveURL(
    new RegExp(`${base}/[0-9a-f-]{36}\\?notice=created$`)
  );
  await expect(
    page.getByRole("heading", { name: "Laddoo", level: 1 })
  ).toBeVisible();
  await expect(
    page.getByText("Add a photo and wait until it is ready before publishing.")
  ).toBeVisible();

  // Upload a photo: it waits for the scan and resizing.
  await page.getByLabel("Photo", { exact: true }).setInputFiles({
    name: "laddoo.jpg",
    mimeType: "image/jpeg",
    buffer: JPEG,
  });
  await page
    .getByLabel("Describe the photo")
    .last()
    .fill("Laddoo on a cushion");
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "Uploaded."
  );
  await expect(
    page.getByText(/Photo 1: (Being checked|Being resized)/)
  ).toBeVisible();
  await checkPage(page, "/organisation/[id]/adoptions/[adoptionId]");

  // The ready draft: publish it and see its public page.
  await page.goto(`${base}/${world.draft.id}`);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page).toHaveURL(`${base}/${world.draft.id}?notice=published`);
  await page.getByRole("link", { name: "See its public page" }).click();
  await expect(page).toHaveURL(`/adopt/${world.draft.slug}`);
  await expect(
    page.getByRole("heading", { name: world.draft.name, level: 1 })
  ).toBeVisible();
  await expect(page.getByText(world.listingName).first()).toBeVisible();

  await page.goto(`${base}/${world.draft.id}`);
  await page.getByRole("button", { name: "Put on hold" }).click();
  await expect(page).toHaveURL(`${base}/${world.draft.id}?notice=held`);
  await expect(
    page.getByText("On hold", { exact: true }).first()
  ).toBeVisible();

  await page.getByRole("link", { name: "Edit details" }).click();
  await expect(page).toHaveURL(`${base}/${world.draft.id}/edit`);
  await checkPage(page, "/organisation/[id]/adoptions/[adoptionId]/edit");
  await field("Colour (optional)").fill("Black");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(`${base}/${world.draft.id}?notice=saved`);

  await page.getByRole("button", { name: "Withdraw" }).click();
  await expect(page).toHaveURL(`${base}/${world.draft.id}?notice=withdrawn`);
  await expect(
    page.getByText("This listing is closed. Its details can't change.")
  ).toBeVisible();
  // Its page is gone (the proxy's memo may take a minute to answer 404).
  await page.goto(`/adopt/${world.draft.slug}`);
  await expect(
    page.getByRole("heading", { name: world.draft.name, level: 1 })
  ).toHaveCount(0);
  expect(violations).toEqual([]);
});
