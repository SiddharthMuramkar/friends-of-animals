import { expect } from "@playwright/test";
import { SEED_GALLERY } from "../../src/server/seed/gallery-samples";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { test } from "./support/seed-account";
import { signInByCode, expectNoSidewaysScrollAt320 } from "./support/sign-in";
import { drainOutbox } from "./support/mailbox";

test("consented gallery, stamped image and anonymous report forms", async ({
  page,
  request,
}, info) => {
  const index = info.project.name === "mobile" ? 1 : 0;
  const id = SEED_GALLERY.items[index]!;
  const title = index === 0 ? "A refuge for birds" : "A kinder street";
  const path = `/gallery/${id}`;
  await page.goto("/");
  await expect(page.getByRole("link", { name: `View ${title}` })).toBeVisible();
  await expect(page.getByText("Your drawing could hang here")).toHaveCount(0);
  await page.goto("/gallery");
  await expect(page.getByRole("link", { name: `View ${title}` })).toBeVisible();
  await expect(
    page
      .getByText(
        "AI illustration — sample artwork, not a participant's submission"
      )
      .first()
  ).toBeVisible();
  await expectAccessible(page, "gallery list");
  await expectAccessibleInDark(page, "gallery list");
  await expectNoSidewaysScrollAt320(page, "gallery list");
  // Native named GET form keeps global valid choices and its selection after
  // filtering, on both keyboard/mobile layouts.
  await page.locator("summary").filter({ hasText: "Filter artworks" }).click();
  const filters = page.getByRole("form", { name: "Filter artworks" });
  await expect(filters.getByLabel("Competition")).toHaveValue("");
  await filters
    .getByLabel("Competition")
    .selectOption({ label: "Art for kindness" });
  await filters.getByLabel("Recognition").selectOption("first");
  await filters.getByRole("button", { name: "Filter artworks" }).click();
  await expect(filters.getByLabel("Recognition")).toHaveValue("first");
  await expect(filters.getByLabel("Competition")).toHaveValue(
    "art-for-kindness"
  );
  await expect(page.getByRole("link", { name: `View ${title}` })).toBeVisible();
  await expectAccessible(page, "filtered gallery");
  await expectAccessibleInDark(page, "filtered gallery");
  await filters.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/gallery$/);
  await page.goto(path);
  const art = page.getByRole("img", { name: `AI illustration: ${title}` });
  await expect(art).toHaveAttribute("src", `/media/gallery/${id}`);
  await expect
    .poll(async () =>
      art.evaluate((img: HTMLImageElement) => new URL(img.currentSrc).search)
    )
    .toBe(info.project.name === "mobile" ? "?size=thumb" : "");
  await art.scrollIntoViewIfNeeded();
  await expect(art).toBeVisible();
  expect(
    (await request.get(`/media/gallery/${id}`)).headers()["cache-control"]
  ).toContain("no-store");
  await expectAccessible(page, "gallery item");
  await expectAccessibleInDark(page, "gallery item");
  await expectNoSidewaysScrollAt320(page, "gallery item");
  await page.getByRole("link", { name: "Report this artwork" }).click();
  await expect(
    page.getByRole("heading", { name: "Report gallery artwork" })
  ).toBeVisible();
  await expectAccessible(page, "gallery report");
  await expectAccessibleInDark(page, "gallery report");
  await expectNoSidewaysScrollAt320(page, "gallery report");
  const concern = `Sample browser concern ${info.project.name}`;
  await page.getByLabel("What is the concern?").selectOption("wrong_credit");
  await page.getByLabel("Details (optional)").fill(concern);
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(
    page.getByText("Thank you. FOA will review your report.")
  ).toBeVisible();
  await expectAccessible(page, "gallery report sent");
});

test("the native report form is accessible and works with scripts disabled", async ({
  page,
  browser,
  baseURL,
}, info) => {
  const id = SEED_GALLERY.items[info.project.name === "mobile" ? 1 : 0]!;
  await page.goto(`/gallery-report/${id}`);
  await expect(page.getByLabel("What is the concern?")).toBeVisible();
  await expectAccessible(page, "native gallery report");
  await expectAccessibleInDark(page, "native gallery report");
  await expectNoSidewaysScrollAt320(page, "native gallery report");
  // The separate native fallback works with JS disabled; it uses the same
  // proof redemption and hourly rate limit. Its issue time is server-signed.
  const plain = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const native = await plain.newPage();
    await native.goto(`/gallery-report/${id}`);
    await expect(native.getByLabel("What is the concern?")).toBeVisible();
    await native.getByLabel("What is the concern?").selectOption("other");
    await native
      .getByLabel("Details (optional)")
      .fill(`Plain ${info.project.name}`);
    // The signed challenge is intentionally too young to redeem until 3s.
    // Wait through actual form completion time, not an arbitrary test retry.
    const at = Date.now();
    await native
      .getByLabel("Your email (optional)")
      .fill("sample@example.test");
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 3500 - (Date.now() - at)))
    );
    await native.getByRole("button", { name: "Send report" }).click();
    await expect(
      native.getByText("Thank you. FOA will review your report.")
    ).toBeVisible();
  } finally {
    await plain.close();
  }
});

test("content manager reviews reports and hides or restores the artwork immediately", async ({
  page,
  request,
  seedAccount,
}, info) => {
  const index = info.project.name === "mobile" ? 1 : 0;
  const id = SEED_GALLERY.items[index]!;
  const title = index === 0 ? "A refuge for birds" : "A kinder street";
  const path = `/gallery/${id}`;
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: `Gallery curator ${info.project.name}`,
    grants: [{ role: "content_manager", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto("/admin/gallery/reports");
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Gallery reports", level: 1 })
  ).toBeVisible();
  const row = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Hide artwork now" }) })
    .first();
  await expect(row).toBeVisible();
  await expectAccessible(page, "moderation queue");
  await expectAccessibleInDark(page, "moderation queue");
  await expectNoSidewaysScrollAt320(page, "moderation queue");
  await row.getByRole("button", { name: "Hide artwork now" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Gallery change saved." })
  ).toBeVisible();
  expect((await request.get(path)).status()).toBe(404);
  expect((await request.get(`/media/gallery/${id}`)).status()).toBe(404);
  await drainOutbox(request);
  // Restore to a reviewed draft then publish explicitly so another journey
  // can crawl the synthetic examples in either project order.
  await page.goto("/admin/gallery");
  const item = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .filter({ hasText: "Hidden" });
  await expect(item).toBeVisible();
  await expectAccessible(page, "curation queue");
  await expectAccessibleInDark(page, "curation queue");
  await expectNoSidewaysScrollAt320(page, "curation queue");
  await item.getByRole("button", { name: "Restore to draft" }).click();
  const draft = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .filter({ hasText: "Draft" });
  await expect(draft).toBeVisible();
  await draft.getByRole("button", { name: "Save reviewed text" }).click();
  await expect(
    draft.getByRole("button", { name: "Publish artwork" })
  ).toBeEnabled();
  await draft.getByRole("button", { name: "Publish artwork" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Gallery change saved." })
  ).toBeVisible();
  await expect(
    page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
      .filter({ hasText: "Published" })
  ).toBeVisible();
  expect((await request.get(path)).status()).toBe(200);
});
