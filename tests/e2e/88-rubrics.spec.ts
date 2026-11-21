import { expect, test } from "@playwright/test";

import { SEED_COMPETITION_MANAGER } from "../../src/server/seed/competitions";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { freshEmail } from "./support/mailbox";
import {
  expectNoSidewaysScrollAt320,
  newDevice,
  signInByCode,
} from "./support/sign-in";

// #88: the seeded competition manager sees which disciplines still block
// school judging, revises a published rubric, is refused while its weights
// don't add up to 100, and publishes it; a member is refused. Each run
// starts a new version of NEIGH27's painting rubric, so a preview database
// takes any number of runs. #60 adds the staff second factor to the
// manager's sign-in.
//
// Seeded competitions (src/server/seed/competitions.ts) and their rubrics
// (src/server/seed/judging.ts):
const NEIGH27 = "01938a00-0000-7000-8000-000000002101";
const WATER27 = "01938a00-0000-7000-8000-000000002102";
const DENIED = "This page is for competition managers";

test("a competition manager sees what blocks school judging, then revises and publishes a rubric", async ({
  page,
  request,
}) => {
  await signInByCode(page, request, SEED_COMPETITION_MANAGER.email);

  // WATER27's essay rubric is only a draft: the list says so.
  const water = `/admin/competitions/${WATER27}/rubrics`;
  await expectRendersAccessibly(page, water);
  await expectAccessibleInDark(page, water);
  await expect(
    page.getByText(
      "School judging can't start yet. These disciplines have no published rubric: Essay."
    )
  ).toBeVisible();
  await expectNoSidewaysScrollAt320(page, water);

  // NEIGH27's painting rubric is published; start its next version.
  const painting = `/admin/competitions/${NEIGH27}/rubrics/painting`;
  await expectRendersAccessibly(page, painting);
  await expectAccessibleInDark(page, painting);
  await page.getByRole("button", { name: /^Start version \d+$/ }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "A new version is ready" })
  ).toBeVisible();
  await expectAccessible(page, `${painting} with a draft`);
  await expectAccessibleInDark(page, `${painting} with a draft`);
  await expectNoSidewaysScrollAt320(page, `${painting} with a draft`);

  // Weights that don't add up to 100 are refused, and what was typed stays.
  const first = page.getByRole("group", { name: "Criterion 1" });
  const weight = first.getByRole("textbox", { name: "Weight, in percent" });
  await weight.fill("20");
  await page.getByRole("button", { name: "Save and publish" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "The weights add up to 90. They must add up to 100 before publishing."
  );
  await expect(weight).toHaveValue("20");
  await expectAccessible(page, `${painting}, refused`);

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

test("a member can't open the rubric pages", async ({
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
});
