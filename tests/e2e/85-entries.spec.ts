import { expect, test } from "@playwright/test";

import { SEED_ACCOUNTS } from "../../src/server/seed/accounts";
import { readMediaFixture } from "../../src/test/media-fixtures";
import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { nonceOf, onlyPolicy, recordCspViolations } from "./support/csp";
import { freshEmail } from "./support/mailbox";
import { signInByCode } from "./support/sign-in";

const ENTRIES = "/participant/entries";
const COMPETITION = "Neighbours on My Street";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

test("a participant sees all three seeded entry outcomes and is offered a retry", async ({
  page,
  request,
}) => {
  await signInByCode(page, request, SEED_ACCOUNTS.members[0].email);
  await expectRendersAccessibly(page, ENTRIES);
  for (const [code, status] of [
    ["NEIGH27-E-5EEDA1", "Submitted"],
    ["ROOF27-E-5EEDA2", "Checking image"],
    ["BIRDS27-E-5EEDA3", "Image rejected"],
  ] as const) {
    await expect(
      page.getByRole("main").getByRole("listitem").filter({ hasText: code })
    ).toContainText(status);
  }
  await expectAccessibleInDark(page, ENTRIES);

  const submitted = `${ENTRIES}/NEIGH27-E-5EEDA1`;
  await expectRendersAccessibly(page, submitted);
  const picture = page.getByRole("img", {
    name: "Submitted image for Shade for the street dogs",
  });
  await expect(picture).toBeVisible();
  await expect(picture).toHaveJSProperty("complete", true);
  expect(
    await picture.evaluate((image: HTMLImageElement) => image.naturalWidth)
  ).toBeGreaterThan(0);
  await expectAccessibleInDark(page, submitted);

  const rejected = `${ENTRIES}/BIRDS27-E-5EEDA3`;
  await expectRendersAccessibly(page, rejected);
  await expect(
    page.getByRole("heading", { level: 1, name: "A sparrow in the jasmine" })
  ).toBeVisible();
  await expect(page.getByText(/did not pass its safety check/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload another image" })
  ).toBeVisible();
  await expectAccessibleInDark(page, rejected);

  await page.goto(submitted);
  const replacement = page.getByRole("button", { name: "Upload replacement" });
  const image = page.getByLabel("Choose an image");
  await page.route("**/api/local-storage/**", async (route) => {
    if (route.request().method() === "PUT") await route.abort();
    else await route.continue();
  });
  await image.setInputFiles({
    name: "first.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await replacement.click();
  await expect(
    page.getByText("We couldn’t receive the image. Please try again.")
  ).toBeVisible();
  await page.unroute("**/api/local-storage/**");

  await page.reload();
  await image.setInputFiles({
    name: "replacement.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(readMediaFixture("rotatedJpeg")),
  });
  await replacement.click();
  await expect(
    page.getByText(
      "Your current image stays submitted while we check its replacement."
    )
  ).toBeVisible();
  await expect(picture).toBeVisible();
});

test("a confirmed individual validates and submits a picture from their dashboard", async ({
  page,
  request,
}, testInfo) => {
  // An upload retains its owner. This account belongs to the disposable
  // test database for the run, alongside its entry and file.
  const email = freshEmail(testInfo.project.name);
  await signInByCode(page, request, email, "Entry Browser Participant");
  await page.goto("/participant/register/neighbours-on-my-street");
  await page
    .getByRole("textbox", { name: "Full name" })
    .fill("Anjali Entry Sen");
  await page.getByLabel("Date of birth").fill("1993-05-14");
  await page
    .getByRole("textbox", { name: "Mobile number" })
    .fill("90000 08501");
  await page.getByRole("textbox", { name: "PIN code" }).fill("411 038");
  await page.getByRole("textbox", { name: "City" }).fill("Pune");
  await page.getByRole("textbox", { name: "State" }).fill("Maharashtra");
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByRole("button", { name: "Pay ₹100.00" }).click();
  await page.getByRole("button", { name: "Pay (test)" }).click();
  await expect(
    page.getByText(/Your registration number is NEIGH27-R-/)
  ).toBeVisible();

  await page.goto("/participant");
  const submitWork = page.getByRole("link", {
    name: `Submit work for ${COMPETITION}`,
  });
  await expect(submitWork).toBeVisible();
  const formPath = (await submitWork.getAttribute("href"))!;
  expect(formPath).toMatch(/^\/participant\/entries\/new\?registration=/);
  await expectRendersAccessibly(page, formPath);
  await expectAccessibleInDark(page, formPath);

  const policy = await onlyPolicy(await page.goto(formPath), formPath);
  expect(nonceOf(policy)).toBeTruthy();
  expect(policy).toMatch(/img-src [^;]*blob:/);
  const violations = await recordCspViolations(page);
  await page.getByLabel("Discipline").selectOption("drawing");
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  const description = page.getByRole("textbox", { name: "Short description" });
  await title.fill("A dog under a neem tree");
  await description.fill("A picture of a dog resting in the shade.");
  const file = page.getByLabel("Choose an image");
  await expect(file).toHaveAttribute("accept", /\.heic/);
  await expect(file).toHaveAccessibleDescription(
    "JPEG, PNG, WebP, HEIC or HEIF. Up to 20 MB."
  );
  const uploads: string[] = [];
  let actionRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT")
      uploads.push(new URL(request.url()).pathname);
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === `${ENTRIES}/new`
    )
      actionRequests += 1;
  });
  await file.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("notes"),
  });
  await expect(file).toHaveAccessibleDescription(/listed file types/);
  await file.setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
  });
  await expect(file).toHaveAccessibleDescription(
    /larger than the listed limit/
  );
  expect(uploads).toEqual([]);

  await file.setInputFiles({
    name: "neem.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(
    page.getByRole("img", { name: "Preview of the selected image" })
  ).toHaveJSProperty("naturalWidth", 1);
  const submit = page.getByRole("button", {
    name: "Submit entry",
    exact: true,
  });
  await title.fill("   ");
  await submit.click();
  await expect(submit).toBeEnabled();
  expect(uploads).toEqual([]);
  expect(actionRequests).toBe(0);
  await expect(title).toHaveAccessibleDescription("Enter a title.");
  await expect(title).toBeFocused();
  await title.fill("A dog in the shade");
  await description.fill("   \n   ");
  await submit.click();
  await expect(description).toHaveAccessibleDescription(
    "Enter a short description."
  );
  await expect(description).toBeFocused();
  expect(uploads).toEqual([]);
  expect(actionRequests).toBe(0);
  await description.fill("A picture of a dog resting in the shade.");

  // Interrupt one PUT, then choose a different image and submit again.
  let droppedUpload = false;
  await page.route("**/api/local-storage/**", async (route) => {
    if (route.request().method() === "PUT" && !droppedUpload) {
      droppedUpload = true;
      await route.abort();
      return;
    }
    await route.continue();
  });
  await submit.click();
  await expect(
    page.getByText("We couldn’t receive the image. Please try again.")
  ).toBeVisible();
  await file.setInputFiles({
    name: "shade.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(readMediaFixture("rotatedJpeg")),
  });

  // Drop one completion request after the next PUT has succeeded.
  let droppedCompletion = false;
  await page.route(`**${ENTRIES}/new?registration=*`, async (route) => {
    if (
      route.request().method() === "POST" &&
      uploads.length === 2 &&
      !droppedCompletion
    ) {
      droppedCompletion = true;
      await route.abort();
      return;
    }
    await route.continue();
  });
  await submit.click();
  await expect(
    page.getByText("We couldn’t finish the upload. Please try again.")
  ).toBeVisible();
  await title.fill("A dog under a neem tree");
  await submit.click();
  await expect(page).toHaveURL(
    /\/participant\/entries\/NEIGH27-E-[0-9A-HJKMNP-TV-Z]{6}$/
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "A dog under a neem tree" })
  ).toBeVisible();
  await expect(page.getByText("Checking image", { exact: true })).toBeVisible();
  expect(droppedCompletion).toBe(true);
  expect(actionRequests).toBe(5);
  expect(uploads).toEqual([
    expect.stringMatching(/^\/api\/local-storage\//),
    expect.stringMatching(/^\/api\/local-storage\//),
  ]);
  expect(uploads[1]).not.toBe(uploads[0]);
  expect(violations).toEqual([]);

  const code = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.goto("/participant");
  await expect(
    page.getByRole("link", { name: `View entry ${code}` })
  ).toBeVisible();
});
