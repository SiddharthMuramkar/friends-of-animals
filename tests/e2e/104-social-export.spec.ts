import { expect } from "@playwright/test";
import { SEED_SOCIAL_EXPORT } from "../../src/server/seed/social-export-samples";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { test } from "./support/seed-account";
import { signInByCode, expectNoSidewaysScrollAt320 } from "./support/sign-in";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";

test("a content manager queues consented gallery art, edits its caption, downloads the actual social stamp and records posting", async ({
  page,
  request,
  seedAccount,
}, info) => {
  const path = `/api/admin/social-export/${SEED_SOCIAL_EXPORT.queued}/image`;
  expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(403);
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: `Social curator ${info.project.name}`,
    grants: [{ role: "content_manager", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto("/admin/social-export");
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Social media export", level: 1 })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "A refuge for birds", exact: true })
  ).toBeVisible();
  // A gallery-only grant does not make artwork a social candidate.
  await expect(
    page.getByRole("heading", { name: "A kinder street", exact: true })
  ).toHaveCount(0);
  await expectAccessible(page, "social export queue and candidates");
  await expectAccessibleInDark(page, "social export queue and candidates");
  await expectNoSidewaysScrollAt320(page, "social export queue and candidates");
  const row = page
    .getByRole("listitem")
    .filter({
      has: page.getByRole("heading", { name: "Our friends", exact: true }),
    });
  await row.getByRole("button", { name: "Queue for social export" }).click();
  await expect(row.getByText("Pending", { exact: true })).toBeVisible();
  await expect(
    row.getByText("Isha D. · Sample Green School · Mumbai", { exact: false })
  ).toBeVisible();
  await row
    .getByLabel("Caption (required)")
    .fill("Kindness to every creature.");
  await row.getByRole("button", { name: "Save caption" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Social export saved." })
  ).toBeVisible();
  const imagePath = await row
    .getByRole("link", { name: "Download stamped image (PNG)" })
    .getAttribute("href");
  const captionPath = await row
    .getByRole("link", { name: "Download caption and credit" })
    .getAttribute("href");
  expect(imagePath).toMatch(/^\/api\/admin\/social-export\//);
  const signed = await page.request.get(imagePath!, { maxRedirects: 0 });
  expect(signed.status()).toBe(302);
  expect(signed.headers()["cache-control"]).toContain("no-store");
  expect(signed.headers().location).toContain("stamp_social_v1");
  expect(signed.headers().location).not.toContain("display_1600");
  const image = await page.request.get(signed.headers().location!);
  expect(image.ok()).toBe(true);
  expect(image.headers()["content-type"]).toBe("image/png");
  expect(image.headers()["content-disposition"]).toContain(".png");
  expect((await image.body()).subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  );
  const caption = await page.request.get(captionPath!);
  expect(caption.ok()).toBe(true);
  expect(caption.headers()["cache-control"]).toContain("no-store");
  expect(await caption.text()).toBe(
    "Kindness to every creature.\n\nCredit: Isha D. · Sample Green School · Mumbai\n"
  );
  await row.getByRole("button", { name: "Mark as posted" }).click();
  await expect(row.getByText("Posted", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Mark as posted" })).toHaveCount(
    0
  );
  await expectAccessible(page, "posted social export");
});
