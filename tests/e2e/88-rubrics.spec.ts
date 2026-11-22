import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_INSTITUTIONS } from "../../src/server/seed/institutions";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { freshEmail } from "./support/mailbox";
import { type SeedAccount, test } from "./support/seed-account";
import {
  expectNoSidewaysScrollAt320,
  newDevice,
  signInByCode,
} from "./support/sign-in";

// #88: a competition manager sees which disciplines still block school
// judging, revises a published rubric, is refused while its weights don't
// add up to 100, and publishes it. A coordinator of a registered school
// finds the judging guide on their dashboard and reads FOA's framework and
// the published rubrics. People without the role are refused. Each run
// starts a new version of one of NEIGH27's rubrics, so a preview database
// takes any number of runs.
//
// Each test seeds its own accounts (and the manager its own authenticator),
// so the desktop and mobile projects can share one app and database: a
// TOTP code works once.
//
// Seeded competitions (src/server/seed/competitions.ts) and their rubrics
// (src/server/seed/judging.ts):
const NEIGH27 = "01938a00-0000-7000-8000-000000002101";
const WATER27 = "01938a00-0000-7000-8000-000000002102";
const DENIED = "This page is for competition managers";

/**
 * A competition manager of this test's own, signed in and past the staff
 * second factor (#60) on `path`.
 */
async function signInManager(
  page: Page,
  request: APIRequestContext,
  seedAccount: SeedAccount,
  path: string
) {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Rubric Manager",
    grants: [{ role: "competition_manager", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto(path);
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

test("a competition manager sees what blocks school judging, then revises and publishes a rubric", async ({
  page,
  request,
  seedAccount,
}, testInfo) => {
  // WATER27's essay rubric is only a draft: the list says so.
  const water = `/admin/competitions/${WATER27}/rubrics`;
  await signInManager(page, request, seedAccount, water);
  await expectRendersAccessibly(page, water);
  await expectAccessibleInDark(page, water);
  await expect(
    page.getByText(
      "School judging can't start yet. These disciplines have no published rubric: Essay."
    )
  ).toBeVisible();
  await expectNoSidewaysScrollAt320(page, water);

  // The competition list links each competition's rubrics.
  await page.goto("/admin/competitions");
  await page
    .getByRole("link", { name: "Rubrics of Neighbours on My Street" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/competitions/${NEIGH27}/rubrics$`)
  );

  // NEIGH27's painting and photography rubrics are published; each
  // project starts the next version of its own one, so the two projects
  // never race for one draft on a shared database.
  const discipline =
    testInfo.project.name === "mobile" ? "photography" : "painting";
  const rubricPage = `/admin/competitions/${NEIGH27}/rubrics/${discipline}`;
  await expectRendersAccessibly(page, rubricPage);
  await expectAccessibleInDark(page, rubricPage);
  await page.getByRole("button", { name: /^Start version \d+$/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "A new version is ready" })
  ).toBeVisible();
  await expectAccessible(page, `${rubricPage} with a draft`);
  await expectAccessibleInDark(page, `${rubricPage} with a draft`);
  await expectNoSidewaysScrollAt320(page, `${rubricPage} with a draft`);

  // Weights that don't add up to 100 are refused, and what was typed stays.
  const first = page.getByRole("group", { name: "Criterion 1" });
  const weight = first.getByRole("textbox", { name: "Weight, in percent" });
  await weight.fill("20");
  await page.getByRole("button", { name: "Save and publish" }).click();
  // The form's own alert, not Next's route announcer.
  await expect(
    page.getByRole("alert").filter({ hasText: "Something needs fixing" })
  ).toContainText(
    "The weights add up to 90. They must add up to 100 before publishing."
  );
  await expect(weight).toHaveValue("20");
  await expectAccessible(page, `${rubricPage}, refused`);

  // Put it back and publish: the old version is replaced.
  await weight.fill("30");
  await page.getByRole("button", { name: "Save and publish" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "The rubric is published" })
  ).toBeVisible();
  const versions = page.getByRole("region", { name: "Versions" });
  await expect(versions.getByText("Published", { exact: true })).toHaveCount(1);
  await expect(versions.getByText("Replaced", { exact: true })).not.toHaveCount(
    0
  );
});

test("a coordinator of a registered school reads the judging guide from their dashboard", async ({
  page,
  request,
  seedAccount,
}) => {
  const email = await seedAccount({
    name: "Asha Coordinator",
    grants: [
      {
        role: "institution_coordinator",
        scope: { type: "institution", id: SEED_INSTITUTIONS.verified.id },
      },
    ],
  });
  await signInByCode(page, request, email);

  await expectRendersAccessibly(page, "/dashboard");
  const guides = page.getByRole("heading", { name: "Judging guides" });
  await expect(guides).toBeVisible();
  // WATER27 takes only individuals: no school round, no guide.
  await expect(page.getByRole("link", { name: /\(WATER27\)$/ })).toHaveCount(0);
  await page
    .getByRole("link", { name: "Neighbours on My Street (NEIGH27)" })
    .click();

  const guide = "/institution/competitions/NEIGH27/judging-guide";
  await expect(page).toHaveURL(new RegExp(`${guide}$`));
  await expectAccessible(page, guide);
  await expectAccessibleInDark(page, guide);
  await expectNoSidewaysScrollAt320(page, guide);
  await expect(
    page.getByRole("heading", { level: 2, name: "FOA's judging framework" })
  ).toBeVisible();
  for (const discipline of ["Drawing", "Painting", "Photography"]) {
    await expect(
      page.getByRole("article", { name: discipline }).getByRole("table")
    ).toBeVisible();
  }

  // Kinder Skies' drawing rubric was revised: the guide shows version 2.
  const skies = "/institution/competitions/SKIES26/judging-guide";
  await expectRendersAccessibly(page, skies);
  await expect(
    page.getByRole("article", { name: "Drawing" }).getByText(/^Version 2,/)
  ).toBeVisible();
});

test("a member can't open the rubric pages or the judging guide", async ({
  browser,
  request,
}, testInfo) => {
  const member = await newDevice(browser, testInfo);
  await signInByCode(
    member,
    request,
    freshEmail(testInfo.project.name),
    "Kiran Shah"
  );

  for (const path of [
    `/admin/competitions/${NEIGH27}/rubrics`,
    `/admin/competitions/${NEIGH27}/rubrics/painting`,
  ]) {
    await member.goto(path);
    await expect(
      member.getByRole("heading", { level: 2, name: DENIED })
    ).toBeVisible();
    await expect(
      member.getByRole("button", { name: "Save and publish" })
    ).toHaveCount(0);
    await expectAccessible(member, `${path}, refused`);
  }

  const guide = "/institution/competitions/NEIGH27/judging-guide";
  await member.goto(guide);
  await expect(
    member.getByRole("heading", {
      level: 2,
      name: "This page is for registered schools",
    })
  ).toBeVisible();
  await expect(member.getByRole("table")).toHaveCount(0);
  await expectAccessible(member, `${guide}, refused`);
});
