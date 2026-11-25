import { expect, type APIRequestContext } from "@playwright/test";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { drainOutbox, readCode, readEmail } from "./support/mailbox";
import { test } from "./support/seed-judge-invitation";
import { signInByCode } from "./support/sign-in";
const NEIGH27 = "01938a00-0000-7000-8000-000000002101";
const WATER27 = "01938a00-0000-7000-8000-000000002102";
const base = "/admin/judging/rounds";

async function invitationPath(
  request: APIRequestContext,
  judge: string,
  name: string
) {
  await drainOutbox(request);
  const email = await readEmail(request, judge, `Invitation to judge ${name}`);
  const invitePath = /\/judge\/invitations\/[A-Za-z0-9_-]{43}/.exec(
    email.text
  )?.[0];
  expect(invitePath).toBeTruthy();
  return invitePath!;
}

test("a manager rejects missing rubrics, creates and opens a round and invites a judge", async ({
  page,
  request,
  seedAccount,
  judgingSetup,
}, testInfo) => {
  const secret = generateTotpSecret();
  const manager = await seedAccount({
    name: "Judging manager",
    grants: [{ role: "competition_manager", scope: { type: "global" } }],
    totpSecret: secret,
  });
  const judge = await seedAccount({ name: "Round judge", grants: [] });
  await signInByCode(page, request, manager);
  await page.goto(base);
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}$`));
  await expectAccessible(page, base);
  await expectAccessibleInDark(page, base);
  await expectRendersAccessibly(page, `${base}/new`);
  await expectAccessibleInDark(page, "new round");
  await page.getByLabel("Competition (required)").selectOption(WATER27);
  await page
    .getByLabel("Round name (required)")
    .fill(`Missing rubric ${Date.now()}`);
  await page.getByRole("button", { name: "Create judging round" }).click();
  // WATER27 is deliberately unready: its essay rubric is missing.
  await expect(
    page.getByText(
      "Every enabled discipline needs a published rubric before a round can be created or opened."
    )
  ).toBeVisible();
  await expectAccessible(page, "missing rubric");
  await page.getByLabel("Competition (required)").selectOption(NEIGH27);
  const name = `National final ${Date.now()} ${testInfo.project.name}`;
  await page.getByLabel("Round name (required)").fill(name);
  await page.getByRole("button", { name: "Create judging round" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expectAccessible(page, "draft round");
  await expectAccessibleInDark(page, "draft round");
  await page.getByRole("button", { name: "Open round", exact: true }).click();
  await expect(page.getByText("Round opened.")).toBeVisible();
  const roundPath = new URL(page.url()).pathname;
  await expectRendersAccessibly(page, `${roundPath}/judges`);
  await expectAccessibleInDark(page, "judges");
  await page.getByLabel("Invited email address (required)").fill(judge);
  await page.getByRole("button", { name: "Invite judge", exact: true }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();
  const invitePath = await invitationPath(request, judge, name);
  // The staff's assignment and conflict screens are audited with an onboarded
  // judge, as in the full journey. The invitee's own browser actions are tested
  // independently below, against a fresh real invitation.
  await judgingSetup.onboard(judge, invitePath.split("/").at(-1)!);
  await expectRendersAccessibly(page, `${roundPath}/pool`);
  await page.getByRole("button", { name: "Admit eligible entries" }).click();
  await expect(page.getByText(/not physically ready/)).toBeVisible();
  await expectAccessible(page, "pool with refusals");
  await expectAccessibleInDark(page, "pool");
  await expectRendersAccessibly(page, `${roundPath}/assignments`);
  await expect(
    page
      .getByLabel("Judge (required)")
      .locator("option", { hasText: "Round judge" })
  ).toHaveCount(1);
  await expectAccessibleInDark(page, "assignments");
  await expectRendersAccessibly(page, `${roundPath}/conflicts`);
  await expect(
    page
      .getByLabel("Judge (required)")
      .locator("option", { hasText: "Round judge" })
  ).toHaveCount(1);
  await expectAccessibleInDark(page, "conflicts");
});

test("an invitee returns after sign-in, accepts the invitation and completes judge onboarding", async ({
  page,
  request,
  seedAccount,
  judgingSetup,
}, testInfo) => {
  const judge = await seedAccount({ name: "Round judge", grants: [] });
  const name = `Onboarding final ${Date.now()} ${testInfo.project.name}`;
  await judgingSetup.invite({ competitionId: NEIGH27, name, email: judge });
  const invitePath = await invitationPath(request, judge, name);
  await expectRendersAccessibly(page, invitePath);
  await expectAccessibleInDark(page, "signed-out invitation");
  await page
    .locator("main")
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(invitePath);
  await page.getByRole("textbox", { name: "Email address" }).fill(judge);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("status")).toContainText(judge);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(await readCode(request, judge));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${invitePath}$`));
  await expectAccessible(page, "matching invitation");
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expectAccessible(page, "onboarding terms");
  await expectAccessibleInDark(page, "onboarding terms");
  await page.getByLabel("I accept the code of conduct").check();
  await page.getByLabel("I accept the confidentiality terms").check();
  await page.getByRole("button", { name: "Accept both terms" }).click();
  await expect(page.getByText("Terms accepted.")).toBeVisible();
  await page.getByLabel("I have no conflicts of interest").check();
  await page.getByRole("button", { name: "Save conflict declaration" }).click();
  await expect(
    page.getByText("Ready for judging", { exact: true })
  ).toBeVisible();
  await expectAccessible(page, "onboarded judge");
  await expectRendersAccessibly(page, "/judge");
  await expectAccessibleInDark(page, "judge dashboard");
  await expect(
    page.getByRole("link", { name: `Onboarding for ${name}` })
  ).toBeVisible();
});
