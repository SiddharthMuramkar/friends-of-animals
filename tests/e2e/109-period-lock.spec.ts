import {
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { test, type SeedAccount } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

// #109: two finance users take turns. One asks to reopen the month the
// seed locked (March 2026); the other approves; then the second asks to
// lock it again and the first approves. The journey never locks a month
// other specs post into (#105 posts on 1 May 2026, payments post today),
// and it leaves March 2026 locked as the seed did.

const periods = "/admin/ledger/periods";
const approvals = "/admin/ledger/approvals";
const month = "March 2026";

async function signInFinance(
  page: Page,
  request: APIRequestContext,
  seedAccount: SeedAccount,
  name: string,
  path: string
): Promise<Page> {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name,
    grants: [{ role: "finance", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto(path);
  await expect(page).toHaveURL(/\/auth\/second-factor\?/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  return page;
}

/** A second person, in their own browser. */
async function secondBrowser(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL });
  return context.newPage();
}

function notice(page: Page, text: string) {
  return page.getByRole("status").filter({ hasText: text });
}

function monthItem(page: Page) {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: month, exact: true }) });
}

/** A request in one list: "Waiting for approval" or "Decided recently". */
function requestItem(page: Page, title: string, list = "Waiting for approval") {
  return page
    .getByRole("region", { name: list, exact: true })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

test("two finance users reopen and relock a month, each approving the other", async ({
  page,
  browser,
  baseURL,
  request,
  seedAccount,
}) => {
  const asha = await signInFinance(
    page,
    request,
    seedAccount,
    "Asha Period Finance",
    periods
  );
  await expectRendersAccessibly(asha, periods);
  await expect(
    asha.getByText(`Locked up to and including ${month}.`)
  ).toBeVisible();
  await expectAccessibleInDark(asha, periods);

  const march = monthItem(asha);
  await expect(march).toContainText("Locked");
  await march
    .getByLabel(`Why ${month} needs to reopen`)
    .fill("A bank charge from March was missed.");
  await march.getByRole("button", { name: `Ask to reopen ${month}` }).click();
  await expect(
    notice(
      asha,
      "Your request to reopen the month is waiting for a second finance user."
    )
  ).toBeVisible();
  await expect(monthItem(asha)).toContainText(
    "A request to reopen it is waiting for a second finance user."
  );

  const bilal = await signInFinance(
    await secondBrowser(browser, baseURL),
    request,
    seedAccount,
    "Bilal Period Finance",
    approvals
  );
  await expectRendersAccessibly(bilal, approvals);
  await expectAccessibleInDark(bilal, approvals);
  const reopen = requestItem(bilal, `Reopen ${month}`);
  await expect(reopen).toContainText("Asked by Asha Period Finance");
  await expect(reopen).toContainText("A bank charge from March was missed.");
  await reopen.getByRole("button", { name: "Approve" }).click();
  await expect(
    notice(bilal, "Approved. The change applies now.")
  ).toBeVisible();

  await bilal.goto(periods);
  await expect(monthItem(bilal)).toContainText("Open");
  await expect(monthItem(bilal)).toContainText(
    "Reason: A bank charge from March was missed."
  );
  await monthItem(bilal)
    .getByRole("button", { name: `Ask to lock ${month}` })
    .click();
  await expect(
    notice(
      bilal,
      "Your request to lock the month is waiting for a second finance user."
    )
  ).toBeVisible();

  // Asha can't approve her own requests, only Bilal's.
  await asha.goto(approvals);
  await expect(requestItem(asha, `Lock ${month}`)).toContainText(
    "Asked by Bilal Period Finance"
  );
  await requestItem(asha, `Lock ${month}`)
    .getByRole("button", { name: "Approve" })
    .click();
  await expect(notice(asha, "Approved. The change applies now.")).toBeVisible();
  await expect(
    requestItem(asha, `Reopen ${month}`, "Decided recently").first()
  ).toContainText("Approved by Bilal Period Finance");

  await asha.goto(periods);
  await expect(
    asha.getByText(`Locked up to and including ${month}.`)
  ).toBeVisible();
  await expect(monthItem(asha)).toContainText("Locked");
  await bilal.context().close();
});

test("a finance user sees a large manual entry waiting and can't approve their own request", async ({
  page,
  request,
  seedAccount,
}) => {
  await signInFinance(
    page,
    request,
    seedAccount,
    "Chitra Entry Finance",
    "/admin/ledger/entries/new"
  );
  const description = `Awards stage hire ${Date.now()}`;
  await page.getByRole("textbox", { name: "Description" }).fill(description);
  const debit = page.getByRole("group", { name: "Line 1", exact: true });
  await debit.getByLabel("Account").selectOption("5600");
  await debit.getByLabel("Amount in rupees").fill("60,000");
  const credit = page.getByRole("group", { name: "Line 2", exact: true });
  await credit.getByLabel("Account").selectOption("1000");
  await credit.getByLabel("Amount in rupees").fill("60,000");
  await page.getByRole("button", { name: "Post entry" }).click();

  await expect(page).toHaveURL(/\/admin\/ledger\/approvals\?requested=entry$/);
  await expect(
    page.getByText(
      "Your entry is above the approval limit, so it waits here for a second finance user."
    )
  ).toBeVisible();
  const mine = page.getByRole("listitem").filter({ hasText: description });
  await expect(mine).toContainText("Asked by you");
  await expect(mine).toContainText("₹60,000.00");
  await expect(mine.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expectAccessibleInDark(page, approvals);

  await mine.getByRole("button", { name: "Withdraw my request" }).click();
  await expect(notice(page, "Your request is withdrawn.")).toBeVisible();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: description })
      .filter({ hasText: "Withdrawn" })
  ).toBeVisible();
});
