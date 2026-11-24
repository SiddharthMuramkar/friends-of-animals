import { expect, test } from "@playwright/test";

import { SEED_COORDINATORS } from "../../src/server/seed/coordinators";
import { SEED_PAYMENTS } from "../../src/server/seed/payments";
import { SEED_SCOPES } from "../../src/server/seed/scopes";
import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { signInByCode } from "./support/sign-in";

// #87's Seam 2 journey: on the school route the seeded school's
// coordinator follows every student's entry on the roster, uploads one
// student's work from that student's page, and certifies the competition's
// conduct. Each page is checked with axe, light and dark. The seed's
// Trees for Birds registration has a student with no entry for each
// project, and each project certifies a registration of its own (desktop
// Trees for Birds, mobile Kinder Skies), so the two never meet on one
// database. Uploads stay "checking" here: no worker runs in E2E, and the
// scan and the family's receipt are Seam 1's.

const SCHOOL = SEED_SCOPES.institution.id;
const TREES = "TREES27-I-5EED3";
const SKIES = SEED_PAYMENTS.paid.reference;
const query = `?institution=${SCHOOL}`;
const roster = (reference: string) =>
  `/institution/registrations/${reference}/submissions${query}`;
const student = (number: string) =>
  `/institution/registrations/${TREES}/submissions/${number}${query}`;
const conduct = (reference: string) =>
  `/institution/registrations/${reference}/conduct${query}`;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

/** The seeded students with no entry yet: one per project. */
const UPLOADS = {
  desktop: { name: "Neel Desai", number: "TREES27-R-5EEDC4" },
  mobile: { name: "Tara Gokhale", number: "TREES27-R-5EEDC5" },
} as const;

function forProject(name: string) {
  return name === "mobile"
    ? { upload: UPLOADS.mobile, certify: SKIES }
    : { upload: UPLOADS.desktop, certify: TREES };
}

test("a coordinator follows every student's entry and uploads one student's work", async ({
  page,
  request,
}, testInfo) => {
  const { upload } = forProject(testInfo.project.name);
  await signInByCode(page, request, SEED_COORDINATORS.coordinator.email);

  await expectRendersAccessibly(page, roster(TREES));
  const rows = page.getByRole("main").getByRole("listitem");
  const row = (name: string) => rows.filter({ hasText: name });
  await expect(row("Ananya Menon")).toContainText("Submitted");
  await expect(row("Ananya Menon")).toContainText("TREES27-E-5EEDC1");
  await expect(row("Ishaan Rao")).toContainText("Checking image");
  await expect(row("Myra Pillai")).toContainText("Image rejected");
  await expect(row("Vihaan Shetty")).toContainText(
    "Work can be uploaded once this student’s registration is confirmed."
  );
  await expectAccessibleInDark(page, roster(TREES));

  // The submitted entry's page shows its picture.
  await page
    .getByRole("link", { name: "Replace picture for Ananya Menon" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Ananya Menon" })
  ).toBeVisible();
  const picture = page.getByRole("img", {
    name: "Submitted image for Bulbuls in the gulmohar",
  });
  await expect(picture).toBeVisible();
  expect(
    await picture.evaluate((image: HTMLImageElement) => image.naturalWidth)
  ).toBeGreaterThan(0);

  await page.goto(roster(TREES));
  await page
    .getByRole("link", { name: `Upload work for ${upload.name}` })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/submissions/${upload.number}\\?institution=`)
  );
  await expectRendersAccessibly(page, student(upload.number));
  await expect(
    page.getByText("No work has been uploaded for this student yet.")
  ).toBeVisible();
  await expectAccessibleInDark(page, student(upload.number));

  await page.getByLabel("Discipline").selectOption("painting");
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Parakeets in the neem");
  await page
    .getByRole("textbox", { name: "Short description" })
    .fill("Green parakeets eating neem berries in the school yard.");
  await page.getByLabel("Choose an image").setInputFiles({
    name: "parakeets.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.getByRole("button", { name: "Submit entry", exact: true }).click();

  // Back on the student's page: the entry exists, its picture being checked.
  await expect(page.getByText(/TREES27-E-[0-9A-Z]{6}/)).toBeVisible();
  await expect(
    page.getByText("We’re checking the uploaded image for safety.")
  ).toBeVisible();
  await expectRendersAccessibly(page, student(upload.number));

  await page.goto(roster(TREES));
  await expect(row(upload.name)).toContainText("Checking image");
  await expect(row(upload.name)).toContainText(/TREES27-E-[0-9A-Z]{6}/);
});

test("a coordinator certifies the competition's conduct once", async ({
  page,
  request,
}, testInfo) => {
  const { certify } = forProject(testInfo.project.name);
  await signInByCode(page, request, SEED_COORDINATORS.coordinator.email);

  await expectRendersAccessibly(page, roster(certify));
  await page.getByRole("link", { name: "Certify conduct" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Conduct certification" })
  ).toBeVisible();
  await expectRendersAccessibly(page, conduct(certify));
  await expect(
    page.getByText(/according to FOA’s guidelines: every/)
  ).toBeVisible();
  await expectAccessibleInDark(page, conduct(certify));

  await page.getByRole("button", { name: "Certify conduct" }).click();
  await expect(
    page.getByText("Thank you. The competition’s conduct is certified.")
  ).toBeVisible();
  await expect(
    page.getByText(
      new RegExp(`Certified by ${SEED_COORDINATORS.coordinator.name} on`)
    )
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Certify conduct" })
  ).toHaveCount(0);
  await expectAccessibleInDark(page, conduct(certify));

  await page.goto(roster(certify));
  await expect(
    page.getByText("Certified. Your school round can be finalised.")
  ).toBeVisible();
});
