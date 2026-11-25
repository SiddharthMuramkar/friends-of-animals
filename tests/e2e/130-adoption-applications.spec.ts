import {
  expect,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";

import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { recordCspViolations } from "./support/csp";
import { test } from "./support/seed-adoption";
import { newDevice, signInByCode } from "./support/sign-in";

// #130: an adult applies to adopt a published animal from its page and
// follows the application from their dashboard; FOA's adoption coordinator
// reviews it and puts them in touch with the listing organisation, whose
// representative then sees their contact; the coordinator records the
// adoption, which closes the animal's listing, and the adopter shares a
// success story that the coordinator publishes on /adopt/stories. Every
// new page shows the FOA-facilitates disclaimer and is checked with axe,
// light and dark. Age rules, consent versions, who may do what and the
// apply-versus-adoption race are covered at Seam 1 and in test:pg
// (src/server/modules/adoption/applications/*.test.ts).
//
// Each test seeds its own organisation and published animal
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

type SeedAccount = (details: {
  name: string;
  grants: {
    role: "adoption_coordinator";
    scope: { type: "global" };
  }[];
  totpSecret?: Uint8Array;
}) => Promise<string>;

/** Fills and sends the application form, ticking the consent. */
async function sendApplication(page: Page, name: string) {
  await page.getByLabel("Mobile number").fill("98765 43210");
  await page
    .getByLabel("Postal address")
    .fill("Flat 4, Sunrise Apartments, Aundh, Pune 411007");
  await page.getByLabel("Date of birth").fill("1990-01-15");
  await page
    .getByLabel("What kind of home do you live in?")
    .selectOption("flat");
  await page
    .getByLabel(`Why ${name}, and how would they fit your life?`)
    .fill("A calm dog suits our flat and our quiet days.");
  await page
    .getByRole("checkbox", {
      name: /I agree that Friends of Animals may share/,
    })
    .check();
  await page.getByRole("button", { name: "Send your application" }).click();
  await expect(page).toHaveURL(/\/dashboard\/adoptions\/[\da-f-]+(\?|$)/);
  await expect(
    page.getByText(
      "Thank you. Your application is with our adoption coordinator."
    )
  ).toBeVisible();
}

/** A fresh adult, signed in, applying for the animal. */
async function applicant(
  page: Page,
  request: Parameters<typeof signInByCode>[1],
  seedAccount: (details: { name: string; grants: [] }) => Promise<string>,
  animal: { slug: string; name: string },
  name: string
) {
  const email = await seedAccount({ name, grants: [] });
  await signInByCode(page, request, email);
  await page.goto(`/dashboard/adoptions/apply/${animal.slug}`);
  await sendApplication(page, animal.name);
  return page.url().split("?")[0]!;
}

/** An adoption coordinator on their own device, second factor passed. */
async function coordinator(
  browser: Browser,
  testInfo: TestInfo,
  request: Parameters<typeof signInByCode>[1],
  seedAccount: SeedAccount
) {
  const page = await newDevice(browser, testInfo);
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: `E2E Adoption Coordinator ${testInfo.project.name}`,
    grants: [{ role: "adoption_coordinator", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto("/admin/adoptions");
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/adoptions$/);
  return page;
}

test("an adult applies to adopt an animal from its page and follows the application", async ({
  page,
  request,
  seedAccount,
  seedAdoptionWorld,
}, testInfo) => {
  const world = await seedAdoptionWorld({ published: true });
  const violations = await recordCspViolations(page);
  const email = await seedAccount({
    name: `E2E Adopter ${testInfo.project.name}`,
    grants: [],
  });
  await signInByCode(page, request, email);

  await page.goto(`/adopt/${world.draft.slug}`);
  await page
    .getByRole("link", { name: `Apply to adopt ${world.draft.name}` })
    .click();
  await expect(page).toHaveURL(
    `/dashboard/adoptions/apply/${world.draft.slug}`
  );
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `Apply to adopt ${world.draft.name}`,
    })
  ).toBeVisible();
  await checkPage(page, "/dashboard/adoptions/apply/[slug]");

  // Without the consent nothing is sent.
  await page.getByRole("button", { name: "Send your application" }).click();
  await expect(
    page.getByText(
      "Please tick the box to agree to sharing your contact details."
    )
  ).toBeVisible();

  await sendApplication(page, world.draft.name);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `Adopting ${world.draft.name}`,
    })
  ).toBeVisible();
  await expect(page.getByText("With the coordinator")).toBeVisible();
  await checkPage(page, "/dashboard/adoptions/[id]");

  await page.goto("/dashboard/adoptions");
  await expect(
    page.getByRole("link", {
      name: `Open your application for ${world.draft.name}`,
    })
  ).toBeVisible();
  await checkPage(page, "/dashboard/adoptions");
  expect(violations).toEqual([]);
});

test("the coordinator puts an applicant in touch, and the organisation then sees their contact", async ({
  page,
  request,
  browser,
  seedAccount,
  seedAdoptionWorld,
}, testInfo) => {
  const world = await seedAdoptionWorld({ published: true });
  const name = `E2E Applicant ${testInfo.project.name}`;
  await applicant(page, request, seedAccount, world.draft, name);

  const staff = await coordinator(browser, testInfo, request, seedAccount);
  await checkPage(staff, "/admin/adoptions");
  await staff
    .getByRole("link", { name: `${name} for ${world.draft.name}` })
    .click();
  await expect(staff).toHaveURL(/\/admin\/adoptions\/[\da-f-]+$/);
  await checkPage(staff, "/admin/adoptions/[id]");
  await staff.getByRole("button", { name: "Start the review" }).click();
  await expect(staff.getByText("Review started.")).toBeVisible();
  await staff
    .getByRole("button", {
      name: `Share the contact with ${world.listingName}`,
    })
    .click();
  await expect(
    staff.getByText("Contact shared with the organisation.")
  ).toBeVisible();

  const owner = await newDevice(browser, testInfo);
  await signInByCode(owner, request, world.ownerEmail);
  await owner.goto(
    `/organisation/${world.listingId}/adoptions/${world.draft.id}`
  );
  await owner
    .getByRole("link", { name: `See applications for ${world.draft.name}` })
    .click();
  await expect(owner).toHaveURL(/\/applications$/);
  await expect(owner.getByText(name, { exact: true })).toBeVisible();
  await expect(owner.getByText("+919876543210")).toBeVisible();
  await checkPage(
    owner,
    "/organisation/[id]/adoptions/[adoptionId]/applications"
  );
});

test("an adoption closes the listing, and the adopter's story is published with their consent", async ({
  page,
  request,
  browser,
  seedAccount,
  seedAdoptionWorld,
}, testInfo) => {
  const world = await seedAdoptionWorld({ published: true });
  const name = `E2E Adopter Story ${testInfo.project.name}`;
  const mine = await applicant(page, request, seedAccount, world.draft, name);

  const staff = await coordinator(browser, testInfo, request, seedAccount);
  await staff
    .getByRole("link", { name: `${name} for ${world.draft.name}` })
    .click();
  const detail = staff.url();
  await staff.getByRole("button", { name: "Start the review" }).click();
  await staff
    .getByRole("button", {
      name: `Share the contact with ${world.listingName}`,
    })
    .click();
  await staff.getByRole("button", { name: "Record the adoption" }).click();
  await expect(
    staff.getByText(
      "Adoption recorded. The listing and its other applications are closed."
    )
  ).toBeVisible();

  // The animal's page now says it was adopted, and takes no applications.
  const visitor = await newDevice(browser, testInfo);
  await visitor.goto(`/adopt/${world.draft.slug}`);
  await expect(
    visitor.getByRole("link", { name: `Apply to adopt ${world.draft.name}` })
  ).toHaveCount(0);

  const story = `${world.draft.name} sleeps on the sofa now and greets everyone at the door.`;
  await page.goto(mine);
  await page.getByLabel("Your story").fill(story);
  await page
    .getByRole("checkbox", {
      name: "I agree to share my story as described above.",
    })
    .check();
  await page.getByRole("button", { name: "Send your story" }).click();
  await expect(
    page.getByText(
      "Thank you. Our adoption coordinator will read your story before it goes up."
    )
  ).toBeVisible();

  await staff.goto(detail);
  await staff.getByRole("button", { name: "Publish the story" }).click();
  await expect(staff.getByText("Story published.")).toBeVisible();

  await visitor.goto("/adopt/stories");
  await expect(visitor.getByText(story)).toBeVisible();
  await expect(visitor.getByText(name)).toHaveCount(0);
  await checkPage(visitor, "/adopt/stories");
});
