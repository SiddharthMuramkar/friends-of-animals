import { expect, test, type Page } from "@playwright/test";

import { countViewTransitions } from "./support/view-transitions";

// Typing and clicks around hydration (refs #55). From the moment a commit
// starts a view transition until the browser runs the transition's update
// callback (a frame at least, longer on a busy machine), React ignores
// every event, then puts focus back on whatever had it when the commit
// began. A click in that window is lost, and text typed into the next field
// lands in the one before. Inside the root layout's <ViewTransition>, a
// part of the page streaming in, a form's reply and a refresh each started
// one, at any moment after the page looked ready. Only a link to another
// page may cross-fade.
//
// A link clicked before the page has fully hydrated still opens the next
// page in full: the header, the page and the footer all show.

/**
 * From now on, each load of `from` clicks the link `selector` from inside
 * the page as soon as React has hydrated the header, while the rest of the
 * page still hydrates at low priority: a visitor tapping a link on a slow
 * phone right after the page appears.
 */
async function clickWhileHydrating(page: Page, from: string, selector: string) {
  await page.addInitScript(
    ([from, selector]) => {
      if (location.pathname !== from) return;
      // React marks each element it has hydrated with a __reactProps$ key.
      const hydrated = (element: Element | null) =>
        element !== null &&
        Object.keys(element).some((key) => key.startsWith("__reactProps"));
      const tryClick = () => {
        const link = document.querySelector<HTMLElement>(selector);
        if (link && hydrated(document.querySelector("body > header"))) {
          link.click();
        } else {
          setTimeout(tryClick, 0);
        }
      };
      tryClick();
    },
    [from, selector]
  );
}

test("a link clicked while the page is still hydrating opens the next page in full", async ({
  page,
}) => {
  // Next keeps the page a visitor leaves in a hidden <Activity>. Leaving
  // before React had hydrated all of it once hid everything after the
  // @exit slot in <body> as well: the header, <main> and the footer stayed
  // blank for good (CI runs 45021193606 and 45028936810; layout.tsx).
  const slug = "neighbours-on-my-street";
  // Every load is a first visit: scripts arrive from the network, so the
  // page is still hydrating when the click comes. (Both projects run
  // Chromium.)
  const devtools = await page.context().newCDPSession(page);
  await devtools.send("Network.enable");
  await devtools.send("Network.setCacheDisabled", { cacheDisabled: true });
  await clickWhileHydrating(
    page,
    "/competitions",
    `main a[href="/competitions/${slug}"]`
  );
  for (let load = 1; load <= 3; load++) {
    await page.goto("/competitions");
    await expect(page).toHaveURL(new RegExp(`/competitions/${slug}$`));
    await expect(
      page.locator("body > header"),
      `header, load ${load}`
    ).toBeVisible();
    await expect(page.locator("main"), `main, load ${load}`).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Neighbours on My Street" })
    ).toBeVisible();
    await expect(page.locator("footer"), `footer, load ${load}`).toBeVisible();
  }
});

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
