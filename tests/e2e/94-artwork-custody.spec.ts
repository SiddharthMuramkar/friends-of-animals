import { expect } from "@playwright/test";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_ARTWORK } from "../../src/server/seed/physical-artwork";
import { SEED_SCOPES } from "../../src/server/seed/scopes";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { drainOutbox } from "./support/mailbox";
import { test } from "./support/seed-account";
import { newDevice, signInByCode } from "./support/sign-in";

const board = "/admin/artwork";
const samplePhoto = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX7cAAAAASUVORK5CYII=",
  "base64"
);

test("FOA resolves a discrepancy, verifies with private condition photos and records custody; a coordinator requests return", async ({
  page,
  request,
  browser,
  seedAccount,
}, info) => {
  const secret = generateTotpSecret();
  const verifier = await seedAccount({
    name: "Artwork verifier",
    grants: [{ role: "foa_verifier", scope: { type: "global" } }],
    totpSecret: secret,
  });
  const coordinator = await seedAccount({
    name: "Artwork return coordinator",
    grants: [
      {
        role: "institution_coordinator",
        scope: { type: "institution", id: SEED_SCOPES.institution.id },
      },
    ],
  });
  await signInByCode(page, request, verifier);
  const discrepancies = `${board}/discrepancies`;
  await page.goto(discrepancies);
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`${discrepancies}$`));
  await expectAccessible(page, discrepancies);
  await expectAccessibleInDark(page, discrepancies);
  await page.getByRole("link", { name: SEED_ARTWORK.codes[4] }).click();
  await expect(
    page.getByRole("heading", { name: "Discrepancy queue" })
  ).toBeVisible();
  await page
    .getByLabel("Resolution (Required)")
    .fill("Matched the corrected Artwork ID to the digital submission.");
  await page.getByRole("button", { name: "Resolve discrepancy" }).click();
  await expect(page.getByText("Artwork updated.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Verify artwork" })
  ).toBeVisible();

  const path = `${board}/${SEED_ARTWORK.codes[3]}`;
  await expectRendersAccessibly(page, path);
  await page.getByRole("link", { name: "Verify artwork" }).click();
  await expect(
    page.getByRole("heading", { name: "Verify original artwork", level: 1 })
  ).toBeVisible();
  await expectAccessible(page, "verification");
  await expectAccessibleInDark(page, "verification");
  for (const kind of ["Front", "Back"]) {
    await page.getByRole("radio", { name: kind, exact: true }).check();
    await page.getByLabel("Condition photo (Required)").setInputFiles({
      name: `${kind}.png`,
      mimeType: "image/png",
      buffer: samplePhoto,
    });
    await page.getByRole("button", { name: "Upload condition photo" }).click();
    await expect(page.getByRole("status")).toContainText("Photo uploaded.");
    await drainOutbox(request);
    await page.reload();
    await expect(
      page.getByRole("checkbox", {
        name: new RegExp(`Select ${kind} photo.*Clean`),
      })
    ).toBeChecked();
  }
  for (const name of [
    "Artwork ID matches the parcel label",
    "Creator matches the entry",
    "Original matches the digital submission",
    "Consent documents checked",
  ]) {
    await page.getByRole("checkbox", { name }).check();
  }
  await page.getByRole("radio", { name: "Good", exact: true }).check();
  await page.getByLabel("Width in mm (Required)").fill("297");
  await page.getByLabel("Height in mm (Required)").fill("420");
  await page.getByLabel("Material (Required)").fill("Watercolour on paper");
  await page
    .getByLabel("Storage or exhibition location (Required)")
    .fill("Store 1 / Rack B");
  await page
    .getByRole("button", { name: "Verify artwork", exact: true })
    .click();
  await expect(page.getByText("Artwork updated.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Verification record" })
  ).toBeVisible();
  const photo = page.getByRole("link", {
    name: "Open Front condition photo (1)",
  });
  await expect(photo).toBeVisible();
  const href = await photo.getAttribute("href");
  expect(href).toBeTruthy();
  expect(href).not.toContain(SEED_ARTWORK.codes[3]);
  await expectAccessible(page, "verified artwork");
  await expectAccessibleInDark(page, "verified artwork");
  await page
    .getByLabel("Put on exhibition · Storage or exhibition location (Required)")
    .fill("Exhibition hall");
  await page
    .getByRole("button", { name: "Put on exhibition", exact: true })
    .click();
  await expect(
    page.getByText("Current storage location: Exhibition hall")
  ).toBeVisible();

  const sender = await newDevice(browser, info);
  try {
    await signInByCode(sender, request, coordinator);
    await expectRendersAccessibly(sender, "/institution/artwork");
    await expectAccessibleInDark(sender, "/institution/artwork");
    const card = sender.getByRole("listitem").filter({
      has: sender.getByRole("heading", { name: SEED_ARTWORK.codes[6] }),
    });
    await card.getByRole("button", { name: "Ask for it back" }).click();
    await expect(
      card.getByText("Return requested", { exact: true })
    ).toBeVisible();
    await expect(
      card.getByRole("link", { name: /condition photo/ })
    ).toHaveCount(0);
  } finally {
    await sender.context().close();
  }
});
