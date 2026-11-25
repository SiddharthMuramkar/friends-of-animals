import { expect, type Page, test } from "@playwright/test";

import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { recordCspViolations } from "./support/csp";

// #70: /competitions and /competitions/[slug] read published competitions
// from the database. Runs against a seeded database (pnpm db:seed, as
// every preview does): the preview seed publishes this competition and
// keeps one draft.
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The IST calendar day of `at`, as the page writes it: "1 November 2026". */
function istDay(at: number): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(at);
}

/**
 * The seed dates its competitions from the day it runs (#71): this one's
 * registration opened at 09:00 IST, 20 days before. The seed ran within
 * the hour before this test, so the day is one of two only when that hour
 * spans IST midnight. Each space matches any space character, since a
 * regex skips toHaveText's whitespace normalising and ICU may write a
 * narrow no-break space.
 */
function opensText(): RegExp {
  const now = Date.now();
  const days = new Set([
    istDay(now - 20 * DAY_MS),
    istDay(now - 20 * DAY_MS - HOUR_MS),
  ]);
  const text = `(${[...days].join("|")}) at 9:00 am IST`;
  return new RegExp(`^${text.replace(/\s+/g, "\\s")}$`);
}

const PUBLISHED = {
  slug: "neighbours-on-my-street",
  name: "Neighbours on My Street",
};
const DRAFT_SLUG = "seed-drawing-competition";

async function hasNoSidewaysScroll(page: Page, label: string) {
  for (const width of [320, 412]) {
    await page.setViewportSize({ width, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow, `sideways scroll on ${label} at ${width} px`).toBe(0);
  }
}

test("the list shows the seeded published competitions and never the draft", async ({
  page,
}) => {
  await expectRendersAccessibly(page, "/competitions");
  const list = page
    .locator("main")
    .getByRole("list")
    .filter({
      has: page.locator('a[href^="/competitions/"]'),
    });
  await expect(
    list.getByRole("link", { name: PUBLISHED.name }).first()
  ).toHaveAttribute("href", `/competitions/${PUBLISHED.slug}`);
  await expect(
    page.locator(`main a[href="/competitions/${DRAFT_SLUG}"]`)
  ).toHaveCount(0);
  // Database competitions are real, not samples.
  await expect(list.getByText("Sample", { exact: true })).toHaveCount(0);

  await expectAccessibleInDark(page, "/competitions");
  await hasNoSidewaysScroll(page, "/competitions");
});

test("age and discipline filters match a single offered category", async ({
  page,
}) => {
  await page.goto("/competitions");
  const filters = page.getByRole("form", { name: "Filter the competitions" });
  const age = filters.getByRole("group", { name: "Age", exact: true });
  const discipline = filters.getByRole("group", { name: "What you make" });
  const status = filters.getByRole("group", { name: "Status" });
  const card = page.locator("li[data-categories]").filter({
    has: page.getByRole("link", { name: PUBLISHED.name, exact: true }),
  });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-categories", /DRAWING-a3/);
  await expect(card).toHaveAttribute("data-categories", /PHOTOGRAPHY-a18/);
  await expect(age.getByRole("radio", { name: "3 to 8" })).toBeVisible();
  await expect(age.getByRole("radio", { name: "18 to 99" })).toBeVisible();

  // Use an intentionally sparse category set for this browser-only CSS
  // test, without changing the database seed shared with other journeys.
  // The token builder's unit tests cover the category-to-token mapping.
  await card.evaluate((el) => {
    el.setAttribute("data-categories", "DRAWING-a3 PHOTOGRAPHY-a18");
    el.setAttribute("data-disciplines", "DRAWING PHOTOGRAPHY");
    el.setAttribute("data-ages", "a3 a18");
  });
  await discipline.getByRole("radio", { name: "Drawing" }).check();
  await age.getByRole("radio", { name: "3 to 8" }).check();
  await expect(card).toBeVisible();

  // The competition offers drawing and an adult age group, but not
  // adult drawing, so independently matching both values is insufficient.
  await age.getByRole("radio", { name: "18 to 99" }).check();
  await expect(card).toBeHidden();
  await discipline.getByRole("radio", { name: "Photography" }).check();
  await expect(card).toBeVisible();
  await age.getByRole("radio", { name: "3 to 8" }).check();
  await expect(card).toBeHidden();
  await age.getByRole("radio", { name: "All", exact: true }).check();
  await expect(card).toBeVisible();
  await discipline.getByRole("radio", { name: "All", exact: true }).check();
  await age.getByRole("radio", { name: "18 to 99" }).check();
  await expect(card).toBeVisible();

  await status.getByRole("radio", { name: "Upcoming" }).check();
  await expect(card).toBeHidden();
  await status.getByRole("radio", { name: "All", exact: true }).check();
  await age.getByRole("radio", { name: "All", exact: true }).check();
  await expect(card).toBeVisible();
});

test("a competition page shows its theme, categories, rules, scope and IST key dates", async ({
  page,
}) => {
  const path = `/competitions/${PUBLISHED.slug}`;
  await expectRendersAccessibly(page, path);
  const main = page.locator("main");

  await expect(main.getByRole("heading", { level: 1 })).toHaveText(
    PUBLISHED.name
  );
  for (const heading of [
    "The kindness behind it",
    "Who can enter, and with what",
    "Dates to remember",
    "The rules",
    "How entries reach the judges",
    "If we ask for your original",
    "Showing your work",
  ]) {
    await expect(
      main.getByRole("heading", { name: heading }),
      heading
    ).toBeVisible();
  }
  await expect(
    main.getByText(/Your age group is set by your age on/)
  ).toBeVisible();
  await expect(
    main.getByRole("table", { name: "Categories by discipline and age group" })
  ).toBeVisible();
  const dates = main
    .getByRole("region", { name: "Dates to remember" })
    .locator("time");
  await expect(dates.first()).toHaveText(opensText());

  await expectAccessibleInDark(page, path);
  await hasNoSidewaysScroll(page, path);
});

test("live registration gives real actions instead of coming-soon copy", async ({
  page,
}) => {
  await page.goto(`/competitions/${PUBLISHED.slug}`);
  const participation = page.locator("#take-part");
  await expect(
    participation.getByRole("heading", { name: "Registration is open" })
  ).toBeVisible();
  await expect(
    participation.getByRole("link", { name: "Register your school" })
  ).toHaveAttribute("href", "/institutions/register");
  await expect(
    participation.getByRole("link", { name: "Register as an individual" })
  ).toHaveAttribute("href", `/participate?competition=${PUBLISHED.slug}`);
  await expect(
    participation.getByText(
      "Online registration opens with the first real competition"
    )
  ).toHaveCount(0);
});

test("ongoing school-only competitions do not offer individual registration", async ({
  page,
}) => {
  await page.goto("/competitions/trees-for-birds");
  const participation = page.locator("#take-part");
  await expect(
    participation.getByRole("heading", { name: "This competition is underway" })
  ).toBeVisible();
  await expect(
    participation.getByRole("link", { name: "Open your dashboard" })
  ).toHaveAttribute("href", "/dashboard");
  await expect(
    participation.getByRole("link", { name: "Register as an individual" })
  ).toHaveCount(0);
  await expect(
    participation.getByRole("link", { name: "Register your school" })
  ).toHaveCount(0);
  await expect(
    participation.getByText(/once accounts are switched on/)
  ).toHaveCount(0);
});

test("a draft, an unknown slug and the build placeholder answer 404", async ({
  request,
}) => {
  for (const slug of [DRAFT_SLUG, "no-such-competition", "__placeholder__"]) {
    const response = await request.get(`/competitions/${slug}`);
    expect(response.status(), slug).toBe(404);
  }
});

test("both pages keep the public policy with no CSP violation", async ({
  page,
}) => {
  const violations = await recordCspViolations(page);

  const list = await page.goto("/competitions");
  expect(list?.status()).toBeLessThan(400);
  await page
    .locator(`main a[href="/competitions/${PUBLISHED.slug}"]`)
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/competitions/${PUBLISHED.slug}$`));
  await expectAccessible(page, "the competition page after navigation");

  const detail = await page.goto(`/competitions/${PUBLISHED.slug}`);
  expect(detail?.status()).toBeLessThan(400);
  const policy =
    detail?.headers()["content-security-policy"] ??
    detail?.headers()["content-security-policy-report-only"];
  expect(policy, "the public policy").toBeTruthy();
  expect(policy).not.toContain("'nonce-");

  expect(violations).toEqual([]);
});
