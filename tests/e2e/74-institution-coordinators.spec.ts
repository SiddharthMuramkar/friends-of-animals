import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { drainOutbox, freshEmail, readEmail } from "./support/mailbox";
import { newDevice, signInByCode } from "./support/sign-in";

// #74: the authorised person of the seeded verified institution invites a
// teacher by email. The teacher opens the link signed out, creates an
// account with that address and accepts; the authorised person then sees
// them on the list and removes them, and withdraws a second invitation.
// Every state of both new pages is checked with axe, light and dark.
// Expiry needs a fake clock, so Seam 1 covers it
// (src/server/modules/institutions/coordinators/accept-invitation.test.ts).

/** The seeded verified institution (src/server/seed/institutions.ts). */
const INSTITUTION = "Seed Public School";
/** Its authorised person, seeded with the institution. */
const ADMIN = "institution-admin@example.test";
const SUBJECT = `Join ${INSTITUTION} as a coordinator on Friends of Animals`;
const LINK = /\/invitations\/[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

/**
 * Invites `address` from the coordinators page in front of the test, and
 * returns the path of the link its email carries.
 */
async function invite(
  page: Page,
  request: APIRequestContext,
  address: string
): Promise<string> {
  await page.getByLabel("Email or mobile number").fill(address);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toContainText(
    `Invitation sent to ${address}.`
  );
  await drainOutbox(request);
  const email = await readEmail(request, address, SUBJECT);
  const path = LINK.exec(email.text)?.[0];
  expect(path, `the invitation link in the email to ${address}`).toBeTruthy();
  return path!;
}

test("an authorised person invites a teacher, who accepts and is then removed", async ({
  browser,
  page,
  request,
}, testInfo) => {
  const run = `${testInfo.project.name} ${Date.now().toString(36)}`;
  const teacherName = `E2E Teacher ${run}`;
  const teacher = freshEmail(testInfo.project.name);

  // The authorised person's list: the seeded coordinator and invitation.
  await signInByCode(page, request, ADMIN);
  await page.goto("/institution");
  await page.getByRole("link", { name: "Manage coordinators" }).click();
  await expect(page).toHaveURL(/\/institution\/coordinators$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Coordinators" })
  ).toBeVisible();
  await expect(page.getByText(`For ${INSTITUTION}`)).toBeVisible();
  await checkBothThemes(page, "/institution/coordinators");

  // Something that is neither an email nor a mobile number is refused.
  await page.getByLabel("Email or mobile number").fill("not an address");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByLabel("Email or mobile number")).toHaveAttribute(
    "aria-invalid",
    "true"
  );
  await checkBothThemes(page, "/institution/coordinators with an error");

  const link = await invite(page, request, teacher);

  // The teacher opens the link signed out.
  const invitee = await newDevice(browser, testInfo);
  await invitee.goto(link);
  await expect(
    invitee.getByText(
      `You're invited to be a teacher coordinator for ${INSTITUTION}.`
    )
  ).toBeVisible();
  await expect(
    invitee.getByRole("main").getByRole("link", { name: "Sign in" })
  ).toBeVisible();
  await checkBothThemes(invitee, "/invitations/[token] signed out");

  // Signed in with another address, the link is for someone else.
  await page.goto(link);
  await expect(
    page.getByText("This invitation is for someone else")
  ).toBeVisible();
  await checkBothThemes(page, "/invitations/[token] for someone else");

  // The teacher creates an account with the invited address and accepts.
  await signInByCode(invitee, request, teacher, teacherName);
  await invitee.goto(link);
  await checkBothThemes(invitee, "/invitations/[token] ready to accept");
  await invitee.getByRole("button", { name: "Accept invitation" }).click();
  await expect(
    invitee.getByRole("heading", { name: "You're a coordinator" })
  ).toBeVisible();
  await checkBothThemes(invitee, "/invitations/[token] accepted");

  // The link works once.
  await page.goto(link);
  await expect(
    page.getByText("This invitation was already accepted")
  ).toBeVisible();
  await checkBothThemes(page, "/invitations/[token] already used");

  // The authorised person sees the new coordinator, and removes them.
  await page.goto("/institution/coordinators");
  await expect(page.getByText(teacherName)).toBeVisible();
  await page
    .getByRole("button", { name: `Remove ${teacherName} as a coordinator` })
    .click();
  await expect(page.getByRole("status")).toContainText("Coordinator removed.");
  await expect(page.getByText(teacherName)).toHaveCount(0);
  await checkBothThemes(page, "/institution/coordinators after a removal");

  // A second invitation, withdrawn: its link stops working. The list shows
  // an address masked to its first letter and domain, so this one gets a
  // domain of its own to pick it out from other runs' invitations.
  const domain = `${run.replace(" ", "-")}.example.test`;
  const withdrawn = await invite(page, request, `withdraw@${domain}`);
  await page
    .getByRole("button", { name: `Withdraw the invitation to w***@${domain}` })
    .click();
  await expect(page.getByRole("status")).toContainText("Invitation withdrawn.");
  await invitee.goto(withdrawn);
  await expect(
    invitee.getByText("This invitation was withdrawn")
  ).toBeVisible();
  await checkBothThemes(invitee, "/invitations/[token] withdrawn");
  await invitee.context().close();
});

test("a link that matches no invitation shows that it doesn't work", async ({
  page,
}) => {
  await page.goto("/invitations/not-a-real-invitation-token");
  await expect(page.getByText("This link doesn't work")).toBeVisible();
  await checkBothThemes(page, "/invitations/[token] not found");
});
