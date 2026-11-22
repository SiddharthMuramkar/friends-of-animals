import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { base32Decode } from "../../src/server/modules/second-factor/domain/base32";
import { totpCode } from "../../src/server/modules/second-factor/domain/totp";
import { SEED_ACCOUNTS } from "../../src/server/seed/accounts";
import { SEED_TOTP_SECRET } from "../../src/server/seed/second-factor";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { recordCspViolations } from "./support/csp";
import { freshEmail, readCode } from "./support/mailbox";

// #111: the CMS. The preview seed publishes version 1 of each policy page.
// Asha, the one seeded content manager, edits the terms page: she saves a
// draft, previews it on the page in Draft Mode, leaves the preview, then
// publishes it. Only this journey signs her in, and each project runs on
// its own server and database (ci.yml), so her one-time codes and the
// page's version numbers are this journey's alone. It reads the current
// version rather than assuming 1, and adds a sentence of its own each run,
// so it can run again on the same data. Then she opens the other pages'
// form editors, previews a site facts draft on the contact page and
// publishes a new home page heading (111b).
//
// The journey is three tests in order, on one page that stays signed in:
// her authenticator code works once, so she signs in once.

const [asha] = SEED_ACCOUNTS.members;

/**
 * Text on the page as shown. Next keeps the page navigated away from in
 * the document, hidden, for going back, and getByText would find it too.
 */
function shownText(page: Page, text: string | RegExp) {
  return page.getByText(text).filter({ visible: true });
}

/** The version in a policy page's "Version N · Last updated" line. */
async function shownVersion(page: Page): Promise<number> {
  const line = shownText(page, /^Version \d+ · Last updated /);
  await expect(line).toBeVisible();
  return Number(/^Version (\d+)/.exec((await line.textContent()) ?? "")?.[1]);
}

/** Signs Asha in, then passes the staff gate's second factor on the way to `path`. */
async function signInAsContentManager(
  page: Page,
  request: APIRequestContext,
  path: string
) {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email address" }).fill(asha.email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(asha.email);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(await readCode(request, asha.email));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account\/sessions$/);

  // A content manager is staff: the gate asks for her authenticator's code
  // (the seeded one), then sends her on to the page.
  await page.goto(path);
  await expect(page).toHaveURL(/\/auth\/second-factor/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(base32Decode(SEED_TOTP_SECRET), new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

test.describe("a content manager edits the site", () => {
  test.describe.configure({ mode: "serial" });

  let context: BrowserContext;
  let page: Page;
  let violations: string[];

  // A page of its own context: axe opens another page beside it.
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    violations = await recordCspViolations(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("she publishes a policy page", async ({ request }) => {
    // Not in the terms yet, so it shows only once added (and is new each run).
    const ADDED = `This sentence was added in the content editor (${Date.now().toString(36)}), to check the preview.`;
    await page.goto("/terms");
    const before = await shownVersion(page);
    await expect(shownText(page, ADDED)).toHaveCount(0);

    await signInAsContentManager(page, request, "/admin/cms");
    // The admin shell tells staff which of FOA's details are still missing:
    // the seed enters none.
    await expect(
      shownText(page, "Some of FOA's details are still missing")
    ).toBeVisible();
    await expectAccessible(page, "/admin/cms");
    await expectAccessibleInDark(page, "/admin/cms");
    const terms = page.getByRole("row", { name: /^Terms of use/ });
    await expect(terms).toContainText(`Version ${before}`);
    await terms.getByRole("link", { name: "Edit the Terms of use" }).click();
    await expect(page).toHaveURL(/\/admin\/cms\/legal_terms$/);
    await expectAccessible(page, "/admin/cms/legal_terms");
    await expectAccessibleInDark(page, "/admin/cms/legal_terms");

    // The editor starts from the published text (or a draft left open):
    // add a paragraph, save it.
    const source = page.getByRole("textbox", { name: "Text", exact: true });
    await source.fill(`${(await source.inputValue()).trimEnd()}\n\n${ADDED}\n`);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Draft saved." })
    ).toBeVisible();
    const draft = page.getByRole("region", { name: "The draft", exact: true });
    await expect(draft).toContainText(ADDED);
    await expectAccessible(page, "/admin/cms/legal_terms with a draft");

    // Preview: the public page shows the draft, and says so, to her alone.
    await draft.getByRole("button", { name: "Preview on the site" }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(
      page.getByRole("status").filter({ hasText: "Draft preview" })
    ).toBeVisible();
    await expect(shownText(page, ADDED)).toBeVisible();
    await expectAccessible(page, "/terms in Draft Mode");

    await page.getByRole("button", { name: "Exit preview" }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(shownText(page, "Draft preview")).toHaveCount(0);
    await expect(shownText(page, ADDED)).toHaveCount(0);
    expect(await shownVersion(page)).toBe(before);

    // Publish: the page shows the new version at once.
    await page.goto("/admin/cms/legal_terms");
    await page
      .getByRole("button", { name: `Publish as version ${before + 1}` })
      .click();
    await expect(
      page.getByRole("status").filter({
        hasText: `Published version ${before + 1}. The page shows it now.`,
      })
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "The draft", exact: true })
    ).toContainText("There is no draft yet.");

    await expectRendersAccessibly(page, "/terms");
    expect(await shownVersion(page)).toBe(before + 1);
    await expect(shownText(page, ADDED)).toBeVisible();
    expect(violations).toEqual([]);
  });

  test("she opens the other pages' form editors", async () => {
    // One field per piece of text.
    for (const key of ["about", "impact", "site_facts"]) {
      await page.goto(`/admin/cms/${key}`);
      await expect(
        page.getByRole("button", { name: "Save draft" })
      ).toBeVisible();
      await expectAccessible(page, `/admin/cms/${key}`);
      await expectAccessibleInDark(page, `/admin/cms/${key}`);
    }
    expect(violations).toEqual([]);
  });

  test("she previews site facts, then publishes a new home heading", async () => {
    // The home page's new heading, new each run.
    const HEADING = `Kindness to animals starts with a drawing (${Date.now().toString(36)})`;
    // A site facts draft's email, previewed and never published.
    const FACTS_EMAIL = `hello-${Date.now().toString(36)}@friendsofanimals.example`;

    // Site facts: a draft email previews on the contact page, to her alone.
    await page.goto("/admin/cms/site_facts");
    await page
      .getByRole("group", { name: "How to reach FOA" })
      .getByRole("textbox", { name: "Email address" })
      .fill(FACTS_EMAIL);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Draft saved." })
    ).toBeVisible();
    await page
      .getByRole("region", { name: "The draft", exact: true })
      .getByRole("button", { name: "Preview on the site" })
      .click();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(
      page.getByRole("status").filter({ hasText: "Draft preview" })
    ).toBeVisible();
    await expect(shownText(page, FACTS_EMAIL)).toBeVisible();
    await expectAccessible(page, "/contact in Draft Mode");
    await page.getByRole("button", { name: "Exit preview" }).click();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(shownText(page, "Draft preview")).toHaveCount(0);
    await expect(shownText(page, FACTS_EMAIL)).toHaveCount(0);

    // The home hero: a new heading, published, shows on the home page.
    await page.goto("/admin/cms/home");
    await expectAccessible(page, "/admin/cms/home");
    await expectAccessibleInDark(page, "/admin/cms/home");
    await page.getByRole("textbox", { name: "Main heading" }).fill(HEADING);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Draft saved." })
    ).toBeVisible();
    // The home page renders its published copy ahead of any request; Draft
    // Mode still shows her the draft, and leaving it never keeps the draft.
    await page
      .getByRole("region", { name: "The draft", exact: true })
      .getByRole("button", { name: "Preview on the site" })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("status").filter({ hasText: "Draft preview" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: HEADING })
    ).toBeVisible();
    await page.getByRole("button", { name: "Exit preview" }).click();
    await expect(shownText(page, "Draft preview")).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: HEADING })
    ).toHaveCount(0);

    await page.goto("/admin/cms/home");
    await page
      .getByRole("button", { name: /^Publish as version \d+$/ })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /Published version \d+\. The page shows it now\./ })
    ).toBeVisible();

    await expectRendersAccessibly(page, "/");
    await expect(
      page.getByRole("heading", { level: 1, name: HEADING })
    ).toBeVisible();
    expect(violations).toEqual([]);
  });
});

test("a member without the role is refused on the site content pages", async ({
  page,
  request,
}, testInfo) => {
  const email = freshEmail(testInfo.project.name);
  await page.goto("/sign-up");
  await page.getByRole("textbox", { name: "Your name" }).fill("Ishaan Mehta");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(await readCode(request, email));
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account\/sessions$/);

  // Holding no staff role, the staff gate lets her through; the page and
  // every editor action refuse her.
  for (const path of ["/admin/cms", "/admin/cms/legal_privacy"]) {
    await expectRendersAccessibly(page, path);
    await expect(
      page.getByRole("heading", {
        name: "Only content managers can open this page",
      })
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Text" })).toHaveCount(0);
  }
});
