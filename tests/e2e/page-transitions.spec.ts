import { expect, test, type Page } from "@playwright/test";

// Typing and clicks around hydration (refs #55). From the moment a commit
// starts a view transition until the browser runs the transition's update
// callback (a frame at least, longer on a busy machine), React ignores
// every event, then puts focus back on whatever had it when the commit
// began. A click in that window is lost, and text typed into the next field
// lands in the one before. Inside the root layout's <ViewTransition>, a
// part of the page streaming in, a form's reply and a refresh each started
// one, at any moment after the page looked ready. Only a link to another
// page may cross-fade.

type Counter = { viewTransitionsStarted: number };

/**
 * Counts the view transitions each page loaded from now on starts. Every
 * one still runs as before.
 */
async function countViewTransitions(
  page: Page
): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const counter = window as unknown as Counter;
    counter.viewTransitionsStarted = 0;
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (...args) => {
      counter.viewTransitionsStarted += 1;
      return start(...args);
    };
  });
  return () =>
    page.evaluate(() => (window as unknown as Counter).viewTransitionsStarted);
}

test("a page starts no view transition as its parts stream in or a form replies, and a link still cross-fades", async ({
  page,
}) => {
  const started = await countViewTransitions(page);

  // The form and its consent box stream in at request time, and so do the
  // header's signed-in parts (nothing, for a visitor).
  await page.goto("/sign-up");
  const send = page.getByRole("button", { name: "Email me a code" });
  await expect(send).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await started(), "view transitions while the page loaded").toBe(0);

  const name = page.getByRole("textbox", { name: "Your name" });
  const email = page.getByRole("textbox", { name: "Email address" });
  await name.fill("Ishaan Mehta");
  await email.fill("not an email address");
  await expect(name).toHaveValue("Ishaan Mehta");
  await expect(email).toHaveValue("not an email address");

  // The reply re-renders the form in place. (A malformed address sends no
  // code, so this spends nothing from the per-IP code limit.)
  await send.click();
  await expect(
    page.getByText("Enter an email address, like name@example.com.")
  ).toBeVisible();
  expect(await started(), "view transitions for the form's reply").toBe(0);

  await page
    .getByRole("main")
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect
    .poll(started, { message: "view transitions for the link" })
    .toBeGreaterThan(0);
});
