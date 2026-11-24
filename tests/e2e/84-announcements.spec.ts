import { expect } from "@playwright/test";

import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_ANNOUNCEMENTS } from "../../src/server/seed/announcements";
import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { test } from "./support/seed-account";
import { signInByCode } from "./support/sign-in";

const competitionId = SEED_ANNOUNCEMENTS.competitionId;
const list = `/admin/competitions/${competitionId}/announcements`;

test("a competition manager can reach the announcement pages and review the send confirmation", async ({
  page,
  request,
  seedAccount,
}) => {
  const totpSecret = generateTotpSecret();
  const email = await seedAccount({
    name: "Announcement Manager",
    grants: [
      {
        role: "competition_manager",
        scope: { type: "competition", id: competitionId },
      },
    ],
    totpSecret,
  });
  await signInByCode(page, request, email);
  await page.goto("/admin/competitions");
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(totpSecret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByRole("link", { name: "Announcements for Neighbours on My Street" })
    .click();
  await expect(page).toHaveURL(new RegExp(`${list}$`));

  await expectRendersAccessibly(page, list);
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: "Registration is open: what happens next",
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Phase 3: the drawing day" })
  ).toHaveAttribute("href", `${list}/${SEED_ANNOUNCEMENTS.draft.id}`);

  await expectRendersAccessibly(page, `${list}/new`);
  await expect(
    page.getByRole("textbox", { name: "Subject", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create draft" })
  ).toBeVisible();

  const detail = `${list}/${SEED_ANNOUNCEMENTS.draft.id}`;
  await expectRendersAccessibly(page, detail);
  await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
  await expectAccessibleInDark(page, detail);
  const send = page.getByRole("button", {
    name: "Send announcement",
    exact: true,
  });
  await send.click();
  const dialog = page.getByRole("dialog", { name: "Send announcement?" });
  await expect(dialog).toBeVisible();
  const backdrop = await dialog.evaluate((element) => {
    // Chrome 111–121 did not inherit custom properties into ::backdrop.
    const legacy = new CSSStyleSheet();
    legacy.replaceSync("dialog::backdrop { --color-black: initial; }");
    document.adoptedStyleSheets.push(legacy);
    try {
      return getComputedStyle(element, "::backdrop").backgroundColor;
    } finally {
      document.adoptedStyleSheets.pop();
    }
  });
  expect(backdrop).toBe("rgba(23, 21, 17, 0.5)");
  await expect(
    dialog.getByText(/Send this announcement to (nobody|\d+ (person|people))/)
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(send).toBeFocused();

  await page.goto(`${list}/new`);
  const project = test.info().project.name;
  const subject = project + "W".repeat(150 - project.length);
  await page
    .getByRole("textbox", { name: "Subject", exact: true })
    .fill(subject);
  await page
    .getByRole("textbox", { name: "Confirmed theme" })
    .fill("Street dogs");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(
    page.getByText("The draft is ready. Preview it below before sending.")
  ).toBeVisible();
  const projectViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(list);
  const open = page.getByRole("link", { name: `Open ${subject}`, exact: true });
  await expect(open).toBeVisible();
  const dimensions = await open.evaluate((link) => {
    const { clientWidth, scrollWidth } = document.documentElement;
    return {
      viewport: clientWidth,
      document: scrollWidth,
      link: link.scrollWidth,
      available: link.clientWidth,
    };
  });
  expect(dimensions.document).toBe(dimensions.viewport);
  expect(dimensions.link).toBe(dimensions.available);
  await page.setViewportSize(projectViewport);

  await open.click();
  await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
  await send.click();
  await expect(dialog).toBeVisible();
  const updatedSubject = `Updated drawing day (${project})`;
  const editor = await page.context().newPage();
  try {
    await editor.goto(page.url());
    await editor
      .getByRole("textbox", { name: "Subject", exact: true })
      .fill(updatedSubject);
    await editor.getByRole("button", { name: "Save draft" }).click();
    await expect(editor.getByText("The draft is saved.")).toBeVisible();
  } finally {
    await editor.close();
  }

  await dialog.getByRole("button", { name: "Send announcement" }).click();
  await expect(
    page.getByRole("alert").filter({
      hasText: "Review the updated preview and confirm the send again.",
    })
  ).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("heading", { name: updatedSubject, exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Subject", exact: true })
  ).toHaveValue(updatedSubject);

  await send.click();
  await dialog.getByRole("button", { name: "Send announcement" }).click();
  await expect(page.getByText(/The announcement is on its way/)).toBeVisible();
});
