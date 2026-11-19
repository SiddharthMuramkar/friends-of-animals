import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// M0 smoke journey (#56): the existing public pages render, and axe finds
// nothing on any of them.

async function expectRendersAccessibly(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `HTTP status of ${path}`).toBeLessThan(400);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.map(({ id, help, nodes }) => ({
      id,
      help,
      targets: nodes.map((node) => node.target.join(" ")),
    })),
    `axe violations on ${path}`
  ).toEqual([]);
}

for (const path of ["/", "/donate", "/safeguarding"]) {
  test(`${path} renders with no axe violations`, async ({ page }) => {
    await expectRendersAccessibly(page, path);
  });
}

test("/competitions and a competition page render with no axe violations", async ({
  page,
}) => {
  await expectRendersAccessibly(page, "/competitions");
  const href = await page
    .locator('main a[href^="/competitions/"]')
    .first()
    .getAttribute("href");
  expect(href, "a competition linked from /competitions").toBeTruthy();
  await expectRendersAccessibly(page, href!);
});
