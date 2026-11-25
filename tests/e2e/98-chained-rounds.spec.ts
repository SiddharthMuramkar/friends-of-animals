import { expect } from "@playwright/test";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_SCORING_COMPETITION } from "../../src/server/seed/competitions";
import { SEED_SCORING } from "../../src/server/seed/scoring";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { newDevice, signInByCode } from "./support/sign-in";
import { test } from "./support/seed-account";

const base = "/admin/judging/rounds";
const code = SEED_SCORING.entryCodes[2];

test("links rounds and admits only eligible locked finalists", async ({
  page,
  request,
  browser,
  seedAccount,
}, testInfo) => {
  const competitionId = SEED_SCORING_COMPETITION.id;
  const secret = generateTotpSecret();
  const manager = await seedAccount({
    name: "Chained round manager",
    grants: [
      {
        role: "competition_manager",
        scope: { type: "competition", id: competitionId },
      },
    ],
    totpSecret: secret,
  });
  await signInByCode(page, request, manager);
  await page.goto(`${base}/new`);
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await expectAccessible(page, "manager factor");
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/new$`));
  await expectAccessible(page, "new round");
  const suffix = `${testInfo.project.name} ${Date.now()}`;
  const sourceName = `State ${suffix}`;
  await page.getByLabel("Competition (required)").selectOption(competitionId);
  await page.getByLabel("Round name (required)").fill(sourceName);
  await page.getByLabel("Level").selectOption("state");
  await page
    .getByLabel("Award scheme", { exact: true })
    .selectOption("grades_ab");
  await page.getByLabel("Judge the physical artwork").uncheck();
  await page.getByRole("button", { name: "Create judging round" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: sourceName })
  ).toBeVisible();
  const sourcePath = new URL(page.url()).pathname;
  const sourceRoundId = sourcePath.split("/").at(-1)!;
  await expectAccessible(page, "source settings");
  await page.getByRole("button", { name: "Open round", exact: true }).click();
  await expect(page.getByText("Round opened.")).toBeVisible();
  await page.goto(`${base}/new`);
  await page.getByLabel("Competition (required)").selectOption(competitionId);
  const finalName = `National ${suffix}`;
  await page.getByLabel("Round name (required)").fill(finalName);
  await page
    .getByLabel("Entry source", { exact: true })
    .selectOption(sourceRoundId);
  await page.getByRole("button", { name: "Create judging round" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: finalName })
  ).toBeVisible();
  const targetPath = new URL(page.url()).pathname;
  await expect(
    page.getByRole("link", { name: `Finalists of ${sourceName} · Open` })
  ).toBeVisible();
  await expectAccessible(page, "linked round");
  await page.goto(`${targetPath}/pool`);
  await expect(
    page.getByText("Waiting for the source round to lock.", { exact: false })
  ).toBeVisible();
  await page.getByRole("button", { name: "Admit eligible entries" }).click();
  await expect(
    page.getByText(
      "Wait for the source round to lock before opening or admitting entries."
    )
  ).toBeVisible();
  await expect(page.getByText(code, { exact: true })).toHaveCount(0);
  await expectAccessible(page, "waiting pool");
  const judgeEmail = await seedAccount({
    name: "State round judge",
    grants: [{ role: "judge", scope: { type: "round", id: sourceRoundId } }],
  });
  const judge = await newDevice(browser, testInfo);
  try {
    await signInByCode(judge, request, judgeEmail);
    const judgePath = `/judge/rounds/${sourceRoundId}`;
    await judge.goto(`${judgePath}/onboarding`);
    await judge.getByLabel("I accept the code of conduct").check();
    await judge.getByLabel("I accept the confidentiality terms").check();
    await judge.getByRole("button", { name: "Accept both terms" }).click();
    await expect(judge.getByText("Terms accepted.")).toBeVisible();
    await judge.getByLabel("I have no conflicts of interest").check();
    await judge
      .getByRole("button", { name: "Save conflict declaration" })
      .click();
    await expect(
      judge.getByText("Ready for judging", { exact: true })
    ).toBeVisible();
    await expectAccessible(judge, "judge onboarding");
    await page.goto(`${sourcePath}/pool`);
    await page.getByRole("button", { name: "Admit eligible entries" }).click();
    await expect(page.getByText(code, { exact: true })).toBeVisible();
    await expectAccessible(page, "source pool");
    await page.goto(`${sourcePath}/assignments`);
    await page
      .getByLabel("Judge (required)")
      .selectOption({ label: "State round judge" });
    await page.getByLabel(code, { exact: true }).check();
    await page
      .getByRole("button", { name: "Assign entries", exact: true })
      .click();
    await expect(page.getByText(/1 assigned;/)).toBeVisible();
    await expectAccessible(page, "source assignment");
    await judge.goto(judgePath);
    await expectAccessible(judge, "assignments");
    await judge.getByRole("link", { name: code }).click();
    // Wait for the destination heading and metadata; the preceding page's
    // nonempty title can otherwise be replaced during the axe scan.
    await expect(
      judge.getByRole("heading", { level: 1, name: code })
    ).toBeVisible();
    await expect(judge).toHaveTitle(/Score this entry/);
    await expectAccessible(judge, "blind score");
    for (const box of await judge.getByRole("spinbutton").all())
      await box.fill("8");
    await judge.getByRole("button", { name: "Save changes" }).click();
    await expect(judge.getByText("Progress: Complete")).toBeVisible();
    await page.goto(`${sourcePath}/rankings`);
    await expect(page.getByText("80.00 / 100 · 1 sheet")).toBeVisible();
    await page.getByRole("button", { name: "Lock judging round" }).click();
    await expect(
      page.getByText("Round locked.", { exact: true })
    ).toBeVisible();
    await expectAccessible(page, "locked source");
    await page.goto(`${targetPath}/pool`);
    await expect(
      page.getByText("0 advancing outcomes in the locked source round.")
    ).toBeVisible();
    await expectAccessible(page, "untagged source");
    await page.goto(`${sourcePath}/rankings`);
    const form = page.getByRole("form", { name: `Recognition for ${code}` });
    await form.getByLabel("Outcome and award").selectOption("finalist");
    await form.getByRole("button", { name: "Save recognition" }).click();
    await expect(
      page.getByText("Outcome saved.", { exact: true })
    ).toBeVisible();
    await page.goto(`${targetPath}/pool`);
    await expect(
      page.getByText("1 advancing outcome in the locked source round.")
    ).toBeVisible();
    await page.getByRole("button", { name: "Admit eligible entries" }).click();
    await expect(page.getByText("1 not physically ready")).toBeVisible();
    await expectAccessible(page, "physical admission refused");
    await page.goto(targetPath);
    await page.getByLabel("Judge the physical artwork").uncheck();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Round settings saved.")).toBeVisible();
    await page.goto(`${targetPath}/pool`);
    await page.getByRole("button", { name: "Admit eligible entries" }).click();
    await expect(page.getByText("1 admitted; 0 refused.")).toBeVisible();
    await expect(page.getByText(code, { exact: true })).toBeVisible();
    for (const other of SEED_SCORING.entryCodes.slice(0, 2))
      await expect(page.getByText(other, { exact: true })).toHaveCount(0);
    await expectAccessible(page, "advanced pool");
    await expectAccessibleInDark(page, "advanced pool");
    await page.goto(targetPath);
    await page.getByRole("button", { name: "Open round", exact: true }).click();
    await expect(page.getByText("Round opened.")).toBeVisible();
    await page.goto(`${targetPath}/rankings`);
    await expect(
      page.getByText("No entries have complete eligible scores yet.")
    ).toBeVisible();
    await expect(page.getByText("80.00 / 100 · 1 sheet")).toHaveCount(0);
    await expectAccessible(page, "independent downstream ranking");
  } finally {
    await judge.context().close();
  }
});
