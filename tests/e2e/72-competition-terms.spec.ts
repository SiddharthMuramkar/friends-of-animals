import { expect, type Page, test as base } from "@playwright/test";

import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_SCOPES } from "../../src/server/seed/scopes";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { recordCspViolations } from "./support/csp";
import { test } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

// #72: a published competition's page shows its fees, the prizes per
// round and links to the exact document versions registering agrees to;
// the link opens that version. A competition manager sets the fees of the
// seeded draft on the fees, prizes and terms page. Every page passes axe
// in light and dark. Runs against a seeded database (pnpm db:seed): the
// preview seed gives "Neighbours on My Street" sample fees (₹100 on your
// own, ₹1,000 through a school), a gold prize in its school round and
// version 1 of the draft competition terms, and makes "A Bowl of Water"
// free.

const PAID = "/competitions/neighbours-on-my-street";
const FREE = "/competitions/a-bowl-of-water";
const DRAFT_TERMS = `/admin/competitions/${SEED_SCOPES.competition.id}/terms`;

function termsCard(page: Page) {
  return page.getByRole("region", { name: "Fees, prizes and terms" });
}

base(
  "a competition's page shows its fees, prizes and the exact terms, which open at that version",
  async ({ page }) => {
    await expectRendersAccessibly(page, PAID);
    const terms = termsCard(page);
    await expect(terms).toContainText("Entering on your own₹100");
    await expect(terms).toContainText(
      "Entering through a school or institution₹1,000"
    );
    await expect(
      terms.getByText("Sample prize: a trophy and art supplies")
    ).toBeVisible();
    await expectAccessibleInDark(page, PAID);

    await terms
      .getByRole("link", { name: "Competition terms (draft), version 1" })
      .click();
    await expect(page).toHaveURL(/\/documents\/competition-terms\/1$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Competition terms (draft)" })
    ).toBeVisible();
    await expect(page.locator("main")).toContainText("Version 1");
    await expectAccessible(page, "/documents/competition-terms/1");
    await expectAccessibleInDark(page, "/documents/competition-terms/1");
  }
);

base("a free competition says so for every way in", async ({ page }) => {
  await expectRendersAccessibly(page, FREE);
  await expect(termsCard(page)).toContainText("Entering on your ownFree");
});

base(
  "a version that doesn't exist shows the not-found page",
  async ({ page }) => {
    // The page streams, so its shell has gone out with 200 by the time the
    // version turns out not to exist; the not-found page follows.
    await page.goto("/documents/competition-terms/999");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "This page has wandered off",
      })
    ).toBeVisible();
  }
);

test("a competition manager sets a draft's fees after a fresh second factor", async ({
  page,
  request,
  seedAccount,
}) => {
  const violations = await recordCspViolations(page);
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Terms Manager",
    grants: [
      {
        role: "competition_manager",
        scope: { type: "competition", id: SEED_SCOPES.competition.id },
      },
    ],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);

  await page.goto(DRAFT_TERMS);
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`${DRAFT_TERMS}$`));

  await expectAccessible(page, DRAFT_TERMS);
  await expectAccessibleInDark(page, DRAFT_TERMS);

  // Both projects share the seeded draft: whichever saves second finds
  // the fees already free.
  await page.getByRole("radio", { name: "Free for everyone" }).check();
  await page.getByRole("button", { name: "Save fees" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /Saved\.|Nothing changed/ })
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Free for everyone" })
  ).toBeChecked();
  expect(violations).toEqual([]);
});
