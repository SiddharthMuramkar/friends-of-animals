import { expect, test, type Page } from "@playwright/test";

import { base32Decode } from "../../src/server/modules/second-factor/domain/base32";
import { totpCode } from "../../src/server/modules/second-factor/domain/totp";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { drainOutbox, freshEmail } from "./support/mailbox";
import { grantGlobalRole } from "./support/roles";
import { newDevice, signInByCode } from "./support/sign-in";

// #115: a member asks to see, correct or erase their data and follows the
// request; FOA's grievance officer works the queue. The officer is a fresh
// account granted the role, who adds an authenticator at #60's staff gate
// (a seeded authenticator would clash across runs: a code works once). The
// export and erasure jobs run through the deployment's drain, as CI has no
// worker. Who else is refused, and what an erasure keeps, is proved at
// Seam 1. Local runs seed erasure on (privacy.erasureEnabled).

/** Signs a fresh account in, grants the role, and passes the staff gate. */
async function officerOn(page: Page, email: string) {
  await signInByCode(page, page.request, email, "Gita Officer");
  await grantGlobalRole(email, "grievance_officer");
  await page.goto("/admin/privacy/requests");
  await expect(page).toHaveURL(
    /\/account\/security\?next=%2Fadmin%2Fprivacy%2Frequests$/
  );
  await page.getByRole("textbox", { name: "Name it" }).first().fill("Phone");
  await page.getByRole("button", { name: "Set up an app" }).click();
  const key = await page
    .getByText(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/)
    .textContent();
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(base32Decode(key ?? ""), new Date()));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/admin\/privacy\/requests$/);
}

/** Files a request from the member's form and returns its reference. */
async function fileRequest(page: Page, type: string): Promise<string> {
  await page.goto("/dashboard/privacy/new");
  await page
    .getByRole("combobox", { name: "What do you want?" })
    .selectOption({ label: type });
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page).toHaveURL(
    /\/dashboard\/privacy\/[0-9a-f-]{36}\?result=filed$/
  );
  const heading = await page.getByRole("heading", { level: 1 }).textContent();
  const reference = /PR-\d{2}-[0-9A-Z]{6}/.exec(heading ?? "")?.[0];
  expect(reference).toBeTruthy();
  return reference!;
}

test("a member asks for a copy of their data, and only they can download it", async ({
  page,
  browser,
}, testInfo) => {
  const email = freshEmail(testInfo.project.name);
  await signInByCode(page, page.request, email, "Asha Rao");

  await page.goto("/dashboard/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your privacy requests"
  );
  await expect(
    page.getByText("You haven't made a privacy request yet.")
  ).toBeVisible();
  await expectAccessible(page, "/dashboard/privacy, empty");
  await expectAccessibleInDark(page, "/dashboard/privacy, empty");

  // A correction needs a description: the error state.
  await page.getByRole("link", { name: "Make a request" }).click();
  await expect(page).toHaveURL(/\/dashboard\/privacy\/new$/);
  await expectAccessible(page, "/dashboard/privacy/new");
  await expectAccessibleInDark(page, "/dashboard/privacy/new");
  await page
    .getByRole("combobox", { name: "What do you want?" })
    .selectOption({ label: "Correct the data" });
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page).toHaveURL(
    /\/dashboard\/privacy\/new\?error=invalid_input$/
  );
  await expect(
    page.getByText("A correction also needs a description", { exact: false })
  ).toBeVisible();
  await expectAccessible(page, "/dashboard/privacy/new, error");

  const reference = await fileRequest(page, "See a copy of the data");
  await expect(
    page.getByText("Your request is in.", { exact: false })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel request" })
  ).toBeVisible();
  await expectAccessible(page, "/dashboard/privacy/[id]");
  await expectAccessibleInDark(page, "/dashboard/privacy/[id]");
  const requestPath = new URL(page.url()).pathname;

  // The grievance officer starts it and asks for the copy.
  const officer = await newDevice(browser, testInfo);
  await officerOn(officer, freshEmail(`${testInfo.project.name}-officer`));
  await expect(officer.getByRole("heading", { level: 1 })).toHaveText(
    "Privacy requests"
  );
  await expectAccessible(officer, "/admin/privacy/requests");
  await expectAccessibleInDark(officer, "/admin/privacy/requests");
  await officer.getByRole("link", { name: reference }).click();
  await expect(
    officer.getByRole("heading", { level: 1, name: `Request ${reference}` })
  ).toBeVisible();
  await expectAccessible(officer, "/admin/privacy/requests/[id]");
  await expectAccessibleInDark(officer, "/admin/privacy/requests/[id]");
  await officer.getByRole("button", { name: "Start this request" }).click();
  await expect(officer.getByText("You started the request.")).toBeVisible();
  await officer
    .getByRole("textbox", { name: "Add a note" })
    .fill(`Identity checked by ${testInfo.project.name}`);
  await officer.getByRole("button", { name: "Add note" }).click();
  await expect(officer.getByText("Your note is saved.")).toBeVisible();
  await officer.getByRole("button", { name: "Prepare the copy" }).click();
  await expect(officer.getByText("The copy is being prepared.")).toBeVisible();
  await expectAccessible(officer, "/admin/privacy/requests/[id], export");
  await drainOutbox(page.request);

  // The member downloads their copy; their page shows no officer notes.
  await page.goto(requestPath);
  await expect(
    page.getByText("Your copy is ready.", { exact: false })
  ).toBeVisible();
  await expect(page.getByText("Identity checked by")).toHaveCount(0);
  await expectAccessible(page, "/dashboard/privacy/[id], ready");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download your copy" }).click();
  expect((await download).suggestedFilename()).toBe(
    `foa-data-${reference}.zip`
  );
  await officer.close();
});

test("the grievance officer previews and carries out an erasure", async ({
  page,
  browser,
}, testInfo) => {
  const email = freshEmail(testInfo.project.name);
  await signInByCode(page, page.request, email, "Ravi Kumar");
  const reference = await fileRequest(page, "Erase the data");

  const officer = await newDevice(browser, testInfo);
  await officerOn(officer, freshEmail(`${testInfo.project.name}-officer`));
  await officer.getByRole("link", { name: reference }).click();
  await expect(
    officer.getByRole("table", {
      name: "What erasure would do with each kind of record",
    })
  ).toBeVisible();
  await expect(
    officer.getByText("Start the request before carrying out the erasure.")
  ).toBeVisible();
  await officer.getByRole("button", { name: "Start this request" }).click();
  await expect(officer.getByText("You started the request.")).toBeVisible();
  await expectAccessible(
    officer,
    "/admin/privacy/requests/[id], erasure preview"
  );
  await expectAccessibleInDark(
    officer,
    "/admin/privacy/requests/[id], erasure preview"
  );
  await officer.getByRole("button", { name: "Carry out this erasure" }).click();
  await expect(
    officer.getByText("The erasure is approved and will run shortly.")
  ).toBeVisible();
  await drainOutbox(page.request);

  await officer.reload();
  await expect(officer.getByText("Partly completed").first()).toBeVisible();
  await expect(
    officer.getByRole("heading", { name: "What the erasure kept" })
  ).toBeVisible();
  await expect(officer.getByText("Their account is gone")).toBeVisible();
  await expectAccessible(officer, "/admin/privacy/requests/[id], erased");
  await officer.close();
});
