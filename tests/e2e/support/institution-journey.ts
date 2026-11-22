import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  generateTotpSecret,
  totpCode,
} from "../../../src/server/modules/second-factor/domain/totp";
import type { SeedAccount } from "./seed-account";
import { signInByCode } from "./sign-in";

// Steps of the institution journey (#77's Seam 2) that #73's spec takes
// one by one: an authorised person sends an institution for checking, and
// an FOA staff admin verifies it.

/**
 * Fills in the institution form as its authorised person (signed in on
 * `page`) and sends it, then sees it waiting for FOA.
 */
export async function sendInstitutionForChecking(page: Page, name: string) {
  await page.goto("/institutions/register");
  const field = (label: string) => page.getByLabel(label, { exact: true });
  await field("Name of the institution").fill(name);
  await field("How many students may take part").fill("240");
  await field("Address").fill("12 Lake Road, Sector 4");
  await field("PIN code").fill("411001");
  await field("City or town").fill("Pune");
  await field("State").fill("Maharashtra");
  await field("Office email").fill("office@example.test");
  await field("Office mobile number").fill("90000 00241");
  await field("Principal's name").fill("Seed Principal");
  await field("Principal's email").fill("principal@example.test");
  await field("Principal's mobile number").fill("90000 00242");
  await page.getByRole("button", { name: "Send for checking" }).click();
  await expect(page).toHaveURL(/\/institution\?registered=1$/);
  await expect(page.getByText("Waiting for FOA to check")).toBeVisible();
}

/**
 * A fresh FOA staff admin, seeded with an authenticator of their own (an
 * authenticator code works once, and both projects share one database),
 * signs in on `page`, passes the second factor, opens the institution
 * from the queue and verifies it. Returns its new Institution ID.
 */
export async function verifyAsStaffAdmin(
  page: Page,
  request: APIRequestContext,
  seedAccount: SeedAccount,
  institutionName: string
): Promise<string> {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Seed FOA Staff Admin",
    grants: [{ role: "staff_admin", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  const queue = "/admin/institutions";
  await page.goto(queue);
  await expect(page).toHaveURL(
    `/auth/second-factor?next=${encodeURIComponent(queue)}`
  );
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(queue);

  await page.getByRole("link", { name: institutionName, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: institutionName })
  ).toBeVisible();
  await page.getByLabel("Reason").fill("Checked with the principal by phone");
  await page.getByRole("button", { name: "Verify" }).click();
  const outcome = page.getByRole("status");
  await expect(outcome).toContainText(/FOA-I-[0-9A-Z]{5}/);
  return /FOA-I-[0-9A-Z]{5}/.exec(await outcome.innerText())![0];
}
