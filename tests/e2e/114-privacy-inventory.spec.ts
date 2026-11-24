import { expect } from "@playwright/test";

import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { test } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

const PRIVACY = "/admin/privacy";

test("a staff admin reads the data inventory after signing in and passing their second factor", async ({
  page,
  request,
  seedAccount,
}) => {
  await page.goto(PRIVACY);
  await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);

  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Inventory administrator",
    grants: [{ role: "staff_admin", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto(PRIVACY);
  await expect(page).toHaveURL(
    `/auth/second-factor?next=${encodeURIComponent(PRIVACY)}`
  );
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(PRIVACY);

  await expectRendersAccessibly(page, PRIVACY);
  await expect(page).toHaveTitle(/^Data inventory\b/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "The personal-data fields FOA keeps and their purposes and retention periods."
  );
  await expect(
    page.getByRole("link", { name: "Data inventory" })
  ).toHaveAttribute("aria-current", "page");

  const notes = page.locator("details").filter({
    has: page.locator("summary").getByText("contact_note", { exact: true }),
  });
  await notes.locator("summary").press("Enter");
  await expect(
    notes.getByText("What staff noted while handling the message")
  ).toBeVisible();
  await expect(
    notes.getByText("Contact sender via message_id", { exact: true })
  ).toBeVisible();
  await expect(
    notes.getByText(/24 months after it is closed/).first()
  ).toBeVisible();

  const consent = page.locator("details").filter({
    has: page.locator("summary").getByText("consent_document", { exact: true }),
  });
  await consent.locator("summary").press("Enter");
  await expect(
    consent.getByText(
      "Kept with the published consent version, which is immutable"
    )
  ).toBeVisible();

  const posts = page.locator("details").filter({
    has: page.locator("summary").getByText("cms_post", { exact: true }),
  });
  await posts.locator("summary").press("Enter");
  await expect(posts.getByText("easy_read", { exact: true })).toBeVisible();
  await expect(
    posts.getByText(
      "The easy-read summary, which may name or describe a person"
    )
  ).toBeVisible();

  const profiles = page.locator("details").filter({
    has: page
      .locator("summary")
      .getByText("participant_profile", { exact: true }),
  });
  await profiles.locator("summary").press("Enter");
  const guardianEmail = profiles.getByRole("listitem").filter({
    has: page.getByText("guardian_email_ciphertext", { exact: true }),
  });
  await expect(
    guardianEmail.getByText(
      /^Guardian contact recorded for the participant via /
    )
  ).toBeVisible();
  await expectAccessibleInDark(page, PRIVACY);
});

test("a signed-in finance user sees a refusal and no inventory rows", async ({
  page,
  request,
  seedAccount,
}) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Inventory finance user",
    grants: [{ role: "finance", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto(PRIVACY);
  await expect(page).toHaveURL(
    `/auth/second-factor?next=${encodeURIComponent(PRIVACY)}`
  );
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(PRIVACY);
  await expect(
    page.getByRole("heading", {
      name: "This page is for staff who manage access",
    })
  ).toBeVisible();
  await expect(page.locator("summary code")).toHaveCount(0);
  await expect(
    page.getByText("guardian_email_ciphertext", { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText("What staff noted while handling the message", {
      exact: true,
    })
  ).toHaveCount(0);
});
