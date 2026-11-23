import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  institutionRegistrationPath,
  studentConsentsPath,
} from "../../src/lib/app-routes";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import {
  drainOutbox,
  freshEmail,
  readCode,
  readEmail,
} from "./support/mailbox";
import { STUDENT, test } from "./support/seed-consent-student";
import { signInByCode } from "./support/sign-in";

async function bothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

async function readLink(request: APIRequestContext, address: string) {
  await drainOutbox(request);
  const receipt = await readEmail(
    request,
    address,
    "Review a guardian consent request"
  );
  const token = /\/consent\/([\w-]{43})(?![\w-])/.exec(receipt.text)?.[1];
  if (!token) throw new Error("Expected a link in the synthetic mailbox");
  expect(receipt.text.includes(STUDENT)).toBe(false);
  return { token, path: `/consent/${token}` };
}

async function queueLink(page: Page, address: string, { resend = false } = {}) {
  const row = page.getByRole("row").filter({ hasText: STUDENT });
  await row
    .getByRole("button", { name: resend ? "Resend link" : "Send link" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: resend ? "Resend a consent link" : "Send a consent link",
  });
  const contact = dialog.getByLabel("Guardian’s email address");
  await contact.fill(address);
  await dialog.getByRole("button", { name: "Send link", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    row.getByText("Consent link queued for delivery.")
  ).toBeVisible();
  await expect(row.getByText("Sent", { exact: true })).toBeVisible();
}

test("a coordinator sends a link and a signed-out guardian answers once using the code", async ({
  page,
  request,
  consentStudent,
}) => {
  const { reference, institutionId, adminEmail, guardianEmail, setLinkExpiry } =
    consentStudent;
  await signInByCode(page, request, adminEmail);
  await page.goto(institutionRegistrationPath(reference, institutionId));
  const manage = page.getByRole("link", { name: "Manage guardian consents" });
  const dashboard = studentConsentsPath(reference, institutionId);
  await expect(manage).toHaveAttribute("href", dashboard);
  await expectRendersAccessibly(page, dashboard);
  const row = page.getByRole("row").filter({ hasText: STUDENT });
  await expect(row.getByText("Not sent")).toBeVisible();
  await expectAccessibleInDark(page, "consent dashboard");

  await row.getByRole("button", { name: "Send link" }).click();
  const dialog = page.getByRole("dialog", { name: "Send a consent link" });
  const address = dialog.getByLabel("Guardian’s email address");
  await expect(address).toHaveValue(guardianEmail);
  await bothThemes(page, "send consent dialog");
  await dialog.getByRole("button", { name: "Send link", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    row.getByText("Consent link queued for delivery.")
  ).toBeVisible();
  const { token, path } = await readLink(request, guardianEmail);

  await page.context().clearCookies();
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  const headers = response?.headers();
  expect(headers?.["referrer-policy"]).toBe("no-referrer");
  expect(headers?.["cache-control"]).toContain("no-store");
  expect(headers?.["x-robots-tag"]).toContain("noindex");
  const nonce = /script-src[^;]*'nonce-([^']+)'/.exec(
    headers?.["content-security-policy"] ?? ""
  )?.[1];
  expect(Boolean(nonce)).toBe(true);
  expect(
    await page.evaluate(
      (value) =>
        Array.from(document.scripts).some(
          (script) => script.src.includes("/_next/") && script.nonce === value
        ),
      nonce
    )
  ).toBe(true);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/
  );
  await expect(page.getByRole("button", { name: "Send a code" })).toBeVisible();
  await bothThemes(page, "start consent");

  await page.getByRole("button", { name: "Send a code" }).click();
  const code = await readCode(request, guardianEmail);
  const entry = page.getByLabel("Six-digit code");
  await expect(entry).toBeVisible();
  await bothThemes(page, "consent code entry");
  await entry.fill(code === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "4 attempts left" })
  ).toBeVisible();
  const answerBy = new Date(Date.now() + 5 * 60_000);
  answerBy.setMilliseconds(0);
  await setLinkExpiry(token, answerBy);
  await entry.fill(code);
  const verification = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === path
  );
  await page.getByRole("button", { name: "Verify code" }).click();
  const display = page.getByRole("group", { name: "Public display" });
  const social = page.getByRole("group", { name: "Social media" });
  await expect(display.getByRole("link", { name: /version/ })).toHaveAttribute(
    "href",
    /^\/documents\/public-display\/\d+$/
  );
  const answer = (await page.context().cookies()).find(
    ({ name }) => name === "foa-consent-answer"
  );
  expect(
    answer?.path === path && answer.httpOnly && answer.sameSite === "Strict"
  ).toBe(true);
  const setCookies = await (await verification).headerValues("set-cookie");
  const expiry = setCookies
    .find((cookie) => cookie.startsWith("foa-consent-answer="))
    ?.match(/; expires=([^;]+)/i)?.[1];
  expect(expiry).toBe(answerBy.toUTCString());
  const deadline = page.getByText(/Save your choices by/).locator("time");
  await expect(deadline).toBeVisible();
  await expect(deadline).toHaveAttribute("datetime", answerBy.toISOString());
  await bothThemes(page, "consent choices");
  await display.getByRole("radio", { name: "I give consent" }).check();
  await social.getByRole("radio", { name: "I decline" }).check();
  await page.getByRole("button", { name: "Save choices" }).click();
  await expect(
    page.getByRole("heading", { name: "Your choices have been saved" })
  ).toBeVisible();
  await bothThemes(page, "consent saved");
  expect(
    (await page.context().cookies()).some(
      ({ name }) => name === "foa-consent-answer"
    )
  ).toBe(false);

  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "This link has already been used" })
  ).toBeVisible();
  await expect(page.getByText(/Tara/)).toHaveCount(0);
  await bothThemes(page, "used consent link");
});

test("a coordinator rejects an invalid guardian destination and keeps the send dialog open", async ({
  page,
  request,
  consentStudent,
}) => {
  const { reference, institutionId, adminEmail } = consentStudent;
  await signInByCode(page, request, adminEmail);
  await page.goto(studentConsentsPath(reference, institutionId));
  const row = page.getByRole("row").filter({ hasText: STUDENT });
  await row.getByRole("button", { name: "Send link" }).click();
  const dialog = page.getByRole("dialog", { name: "Send a consent link" });
  const address = dialog.getByLabel("Guardian’s email address");
  // A single-label domain passes the browser's email constraint, so this
  // exercises the server's destination validation without bypassing the form.
  await address.fill("guardian@example");
  await dialog.getByRole("button", { name: "Send link", exact: true }).click();

  const error = "Enter a valid address for the selected delivery method.";
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(error);
  await expect(address).toHaveAccessibleDescription(error);
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await expect(address).toBeFocused();
  await bothThemes(page, "invalid guardian destination");

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(row.getByText("Not sent")).toBeVisible();
});

test("a replacement withdraws the first link, and an expired replacement shows no child details", async ({
  page,
  request,
  consentStudent,
}, testInfo) => {
  const { reference, institutionId, adminEmail, guardianEmail, setLinkExpiry } =
    consentStudent;
  await signInByCode(page, request, adminEmail);
  const dashboard = studentConsentsPath(reference, institutionId);
  await page.goto(dashboard);
  await queueLink(page, guardianEmail);
  const original = await readLink(request, guardianEmail);
  const replacementAddress = freshEmail(testInfo.project.name);
  await queueLink(page, replacementAddress, { resend: true });
  const replacement = await readLink(request, replacementAddress);
  expect(original.token === replacement.token).toBe(false);

  await page.goto(original.path);
  await expect(
    page.getByRole("heading", { name: "This consent link was withdrawn" })
  ).toBeVisible();
  await expect(page.getByText(/Tara/)).toHaveCount(0);
  await bothThemes(page, "withdrawn consent link");

  await setLinkExpiry(replacement.token, new Date(Date.now() - 86_400_000));
  await page.goto(replacement.path);
  await expect(
    page.getByRole("heading", { name: "This consent link has expired" })
  ).toBeVisible();
  await expect(page.getByText(/Tara/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send a code" })).toHaveCount(
    0
  );
  await bothThemes(page, "expired consent link");

  await page.goto(dashboard);
  const row = page.getByRole("row").filter({ hasText: STUDENT });
  await expect(row.getByText("Expired", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Withdraw link" }).click();
  await expect(row.getByText("Withdrawn", { exact: true })).toBeVisible();
});
