import { expect } from "@playwright/test";

import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { test } from "./support/seed-guardian";
import { signInByCode } from "./support/sign-in";

const pausedUrl = process.env.PLAYWRIGHT_GUARDIAN_PAUSED_URL;
test.use({ baseURL: pausedUrl });
test.beforeAll(() => {
  if (!pausedUrl) {
    throw new Error(
      "Set PLAYWRIGHT_GUARDIAN_PAUSED_URL to the loopback staging test server."
    );
  }
});

const setupPaused = "Guardian setup is coming soon";
const registrationPaused =
  "Individual registration for under-18s is coming soon.";

test("direct guardian setup routes offer a return link while setup is paused", async ({
  page,
  request,
  seedAccount,
}) => {
  const email = await seedAccount({ name: "E2E Guardian Setup", grants: [] });
  await signInByCode(page, request, email);

  for (const { path, title, back, href } of [
    {
      path: "/guardian/register",
      title: "Register as a parent or guardian",
      back: "Back to your dashboard",
      href: "/dashboard",
    },
    {
      path: "/guardian/children/new",
      title: "Add a child",
      back: "Back to your children",
      href: "/guardian",
    },
  ]) {
    await expectRendersAccessibly(page, path);
    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { level: 1, name: title })
    ).toBeVisible();
    await expect(
      main.getByRole("heading", { name: setupPaused })
    ).toBeVisible();
    await expect(main.getByRole("link", { name: back })).toHaveAttribute(
      "href",
      href
    );
    await expect(main.getByRole("textbox")).toHaveCount(0);
    await expectAccessibleInDark(page, path);
  }
});

test("an invited teen sees the setup pause and can return home", async ({
  page,
  request,
  seedAccount,
  seedGuardian,
}) => {
  const email = await seedAccount({ name: "E2E Invited Teen", grants: [] });
  const { invitation } = await seedGuardian({
    name: "E2E Inviting Guardian",
    children: [{ fullName: "E2E Invited Teen", age: 15 }],
    invite: { email },
  });
  if (!invitation) throw new Error("No pending teen invitation");
  await signInByCode(page, request, email);

  const response = await page.goto(invitation);
  expect(response?.status(), "HTTP status of the invitation").toBeLessThan(400);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: setupPaused })).toBeVisible();
  await expect(
    main.getByRole("link", { name: "Go to the home page" })
  ).toHaveAttribute("href", "/");
  await expect(
    main.getByRole("button", { name: "Accept invitation" })
  ).toHaveCount(0);
  await expectAccessible(page, "pending teen invitation");
  await expectAccessibleInDark(page, "pending teen invitation");
});

test("a guardian can withdraw a pending invitation and reach existing registrations during the pause", async ({
  page,
  request,
  seedGuardian,
}) => {
  const { email, childIds, invitation } = await seedGuardian({
    name: "E2E Guardian With Pending Invitation",
    children: [{ fullName: "E2E Teen With Pending Invitation", age: 15 }],
    invite: { email: "pending-teen@example.test" },
  });
  if (!invitation) throw new Error("No pending teen invitation");
  await signInByCode(page, request, email);

  const path = `/guardian/children/${childIds[0]}`;
  await expectRendersAccessibly(page, path);
  const main = page.getByRole("main");
  await expect
    .soft(main.getByText("Teen login invitations are currently unavailable."))
    .toBeVisible();
  await expect.soft(main.getByText(/The link works until/)).toHaveCount(0);
  await expect.soft(main.getByText(registrationPaused)).toBeVisible();
  await expect
    .soft(main.getByRole("link", { name: "Find a competition" }))
    .toHaveCount(0);
  await expect(
    main.getByRole("link", { name: "My competitions" })
  ).toHaveAttribute("href", "/participant");
  await expectAccessibleInDark(page, path);

  await main.getByRole("button", { name: "Withdraw invitation" }).click();
  await expect(page.getByRole("status")).toContainText("Invitation withdrawn.");
  await page.goto(invitation);
  await expect(
    main.getByRole("heading", { name: "This invitation was withdrawn" })
  ).toBeVisible();
});

test("the adult form remains available while child registration choices are paused", async ({
  page,
  request,
  seedGuardian,
}) => {
  const child = "E2E Paused Child Entrant";
  const { email } = await seedGuardian({
    name: "E2E Guardian Registering Personally",
    children: [{ fullName: child, age: 9 }],
  });
  await signInByCode(page, request, email);

  const path = "/participant/register/neighbours-on-my-street";
  await expectRendersAccessibly(page, path);
  const main = page.getByRole("main");
  await expect.soft(main.getByText(registrationPaused)).toBeVisible();
  await expect
    .soft(main.getByRole("link", { name: `Register ${child}` }))
    .toHaveCount(0);
  await expect
    .soft(main.getByText(/You'll be asked who your parent or guardian is/))
    .toHaveCount(0);
  await expect(main.getByLabel("Date of birth")).toBeVisible();
  await expect(
    main.getByRole("button", { name: "Register", exact: true })
  ).toBeEnabled();
  await expectAccessibleInDark(page, path);
});
