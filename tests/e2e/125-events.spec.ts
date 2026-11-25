import { expect, type Page } from "@playwright/test";
import { test } from "./support/seed-guardian";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import {
  expectNoSidewaysScrollAt320,
  newDevice,
  signInByCode,
} from "./support/sign-in";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { instantToIstLocal } from "../../src/server/modules/competitions/domain/ist";
import { SEED_EVENTS } from "../../src/server/seed/event-fixtures";

async function check(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
  await expectNoSidewaysScrollAt320(page, label);
}

test("public events and campaign pages are current and accessible", async ({
  page,
  request,
}, info) => {
  const fixture =
    info.project.name === "mobile" ? SEED_EVENTS.mobile : SEED_EVENTS.full;
  const detail = `/events/${fixture.slug}`;
  await page.goto("/events");
  await expect(
    page.getByRole("heading", { name: "Events and campaigns", level: 1 })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: fixture.title })
  ).toBeVisible();
  await check(page, "public events list");
  expect((await request.get("/events/not-a-real-event")).status()).toBe(404);
  expect(
    (await request.get(`/events/${SEED_EVENTS.draft.slug}`)).status()
  ).toBe(404);
  await page.goto(detail);
  await expect(
    page.getByRole("heading", { name: fixture.title })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in to register" })
  ).toBeVisible();
  await check(page, "public event detail");
});

test("published events, waitlist promotion, check-in and attendee timeline", async ({
  page,
  request,
  browser,
  seedAccount,
}, info) => {
  const fixture =
    info.project.name === "mobile" ? SEED_EVENTS.mobile : SEED_EVENTS.full;
  const detail = `/events/${fixture.slug}`;
  const name = `Event attendee ${info.project.name}`;
  const email = await seedAccount({ name, grants: [] });
  await signInByCode(page, request, email);
  await page.goto(detail);
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByText("Your place is confirmed.")).toHaveCount(0);
  await expect(
    page.getByText("You have joined the waitlist.", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(/Waitlisted · Waitlist position: 1/)
  ).toBeVisible();
  await check(page, "signed-in registration panel");
  await page.goto("/dashboard/events");
  await expect(page.getByText("Waitlisted", { exact: true })).toBeVisible();
  await check(page, "my event registrations");

  const manager = await newDevice(browser, info);
  try {
    const secret = generateTotpSecret();
    const managerEmail = await seedAccount({
      name: `Event organiser ${info.project.name}`,
      grants: [{ role: "community_manager", scope: { type: "global" } }],
      totpSecret: secret,
    });
    await signInByCode(manager, request, managerEmail);
    await manager.goto("/admin/events");
    await expect(manager).toHaveURL(/\/auth\/second-factor\?next=/);
    await manager
      .getByRole("textbox", { name: "6-digit code" })
      .fill(totpCode(secret, new Date()));
    await manager.getByRole("button", { name: "Continue" }).click();
    await expect(manager).toHaveURL(/\/admin\/events$/);
    await expect(
      manager.getByRole("heading", { name: fixture.title })
    ).toBeVisible();
    await manager.goto(`/admin/events/${fixture.id}/registrations`);
    const first = manager.getByRole("listitem").filter({
      has: manager.getByRole("heading", { name: "Ravi Kumar", exact: true }),
    });
    await expect(first).toBeVisible();
    await check(manager, "registrations and waitlist");
    await first.getByRole("button", { name: "Cancel registration" }).click();
    await expect(
      manager
        .getByRole("listitem")
        .filter({ has: manager.getByRole("heading", { name, exact: true }) })
        .getByText("Registered", { exact: true })
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText("Registered", { exact: true })).toBeVisible();
    await manager.goto(`/admin/events/${fixture.id}/check-in`);
    await expect(
      manager.getByRole("heading", { name, exact: true })
    ).toBeVisible();
    await check(manager, "check-in sheet");
    await manager.getByLabel("Search attendees by name").fill(name);
    await manager.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      manager.getByRole("heading", { name, exact: true })
    ).toBeVisible();
    await manager
      .getByRole("button", { name: "Check in", exact: true })
      .click();
    await expect(
      manager
        .getByRole("listitem")
        .filter({ has: manager.getByRole("heading", { name, exact: true }) })
        .getByText("Checked in", { exact: true })
    ).toBeVisible();
    await page.goto("/dashboard/timeline");
    await expect(
      page.getByText("Attended an FOA event", { exact: true })
    ).toHaveCount(1);
    await expect(page.getByText(fixture.title, { exact: true })).toBeVisible();
    await check(page, "attendance timeline");
  } finally {
    await manager.context().close();
  }
});

test("organiser creates, publishes and cancels a campaign", async ({
  page: manager,
  request,
  seedAccount,
}, info) => {
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: `Event publisher ${info.project.name}`,
    grants: [{ role: "content_manager", scope: { type: "global" } }],
    totpSecret: secret,
  });
  await signInByCode(manager, request, email);
  await manager.goto("/admin/events");
  await expect(manager).toHaveURL(/\/auth\/second-factor\?next=/);
  await manager
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await manager.getByRole("button", { name: "Continue" }).click();
  await expect(manager).toHaveURL(/\/admin\/events$/);
  await check(manager, "event admin list");
  await manager.getByRole("link", { name: "Create an event" }).click();
  await expect(
    manager.getByRole("heading", { name: "Create an event", level: 1 })
  ).toBeVisible();
  await check(manager, "create event form");
  const title = `Preview campaign ${info.project.name}`;
  await manager.getByLabel("Type", { exact: true }).selectOption("campaign");
  await manager.getByLabel("Title", { exact: true }).fill(title);
  await manager
    .getByLabel("Short summary")
    .fill("Support clean water for neighbourhood animals.");
  await manager
    .getByLabel("Starts (IST)", { exact: true })
    .fill(instantToIstLocal(new Date(Date.now() + 72 * 3600_000)));
  await manager
    .getByLabel("Ends (IST)", { exact: true })
    .fill(instantToIstLocal(new Date(Date.now() + 74 * 3600_000)));
  await manager.getByRole("button", { name: "Save draft" }).click();
  await expect(
    manager.getByRole("heading", { name: title, level: 1 })
  ).toBeVisible();
  await check(manager, "event edit form");
  await manager.getByRole("button", { name: "Publish event" }).click();
  await expect(manager.getByText("Published", { exact: true })).toBeVisible();
  await manager
    .getByRole("button", { name: "Cancel event", exact: true })
    .click();
  await expect(manager.getByText("Cancelled", { exact: true })).toBeVisible();
});

test("verified guardians can register a child on a separate private page", async ({
  page,
  request,
  seedGuardian,
}, info) => {
  const family = await seedGuardian({
    name: `Event guardian ${info.project.name}`,
    children: [{ fullName: `Event child ${info.project.name}`, age: 10 }],
  });
  await signInByCode(page, request, family.email);
  await page.goto(`/guardian/children/${family.childIds[0]}`);
  await page.getByRole("link", { name: "Events for this child" }).click();
  await expect(
    page.getByRole("heading", { name: "Child’s event registrations", level: 1 })
  ).toBeVisible();
  await check(page, "guardian event registration page");
  const card = page.getByRole("listitem").filter({
    has: page.getByRole("heading", {
      name: SEED_EVENTS.campaign.title,
      exact: true,
    }),
  });
  await expect(card).toBeVisible();
  // The campaign is for active members; only the child's membership counts.
  await card.getByRole("button", { name: "Register", exact: true }).click();
  await expect(
    page.getByText(
      "Join the FOA community before registering for this event.",
      { exact: true }
    )
  ).toBeVisible();
  await page.goto(`/guardian/children/${family.childIds[0]}/timeline`);
  await page
    .getByLabel("Display name (required)")
    .fill(`Event child ${info.project.name}`);
  await page
    .getByRole("button", { name: "Join the community", exact: true })
    .click();
  await expect(page.getByText("Active member", { exact: true })).toBeVisible();
  await page.goto(`/guardian/children/${family.childIds[0]}/events`);
  await page
    .getByRole("listitem")
    .filter({
      has: page.getByRole("heading", {
        name: SEED_EVENTS.campaign.title,
        exact: true,
      }),
    })
    .getByRole("button", { name: "Register", exact: true })
    .click();
  await expect(
    page.getByText("Your place is confirmed.", { exact: true })
  ).toBeVisible();
});
