import { expect } from "@playwright/test";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_ARTWORK_COMPETITION } from "../../src/server/seed/competitions";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { newDevice, signInByCode } from "./support/sign-in";
import { test } from "./support/seed-account";

const base = "/admin/judging/rounds";
const code = "ORIG27-E-5EED06";
const unavailable = "ORIG27-E-5EED04";

test("blind physical scoring, guarded lock and recognition", async ({
  page,
  request,
  browser,
  seedAccount,
}, testInfo) => {
  const secret = generateTotpSecret();
  const manager = await seedAccount({
    name: "Round lock manager",
    grants: [
      {
        role: "competition_manager",
        scope: { type: "competition", id: SEED_ARTWORK_COMPETITION.id },
      },
    ],
    totpSecret: secret,
  });
  await signInByCode(page, request, manager);
  await page.goto(`${base}/new`);
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await expectAccessible(page, "staff factor");
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/new$`));
  await expectAccessible(page, "new round");
  await page
    .getByLabel("Competition (required)")
    .selectOption(SEED_ARTWORK_COMPETITION.id);
  const name = `Scoring lock ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel("Round name (required)").fill(name);
  await page.getByRole("button", { name: "Create judging round" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expectAccessible(page, "draft round");
  await page.getByRole("button", { name: "Open round", exact: true }).click();
  await expect(page.getByText("Round opened.")).toBeVisible();
  const path = new URL(page.url()).pathname;
  const roundId = path.split("/").at(-1)!;
  const judgeEmail = await seedAccount({
    name: "Physical scoring judge",
    grants: [{ role: "judge", scope: { type: "round", id: roundId } }],
  });
  const judge = await newDevice(browser, testInfo);
  const judgePath = `/judge/rounds/${roundId}`;
  try {
    await signInByCode(judge, request, judgeEmail);
    await judge.goto(`${judgePath}/onboarding`);
    await expectAccessible(judge, "judge onboarding");
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
    await expectAccessible(judge, "ready judge");
    await page.goto(`${path}/pool`);
    await expectAccessible(page, "pool");
    await page.getByRole("button", { name: "Admit eligible entries" }).click();
    await expect(page.getByText(/not physically ready/)).toBeVisible();
    await expect(page.getByText(code, { exact: true })).toBeVisible();
    await expect(page.getByText(unavailable, { exact: true })).toHaveCount(0);
    await expectAccessible(page, "admitted physical pool");
    await page.goto(`${path}/assignments`);
    await page
      .getByLabel("Judge (required)")
      .selectOption({ label: "Physical scoring judge" });
    await page.getByLabel(code, { exact: true }).check();
    await page
      .getByRole("button", { name: "Assign entries", exact: true })
      .click();
    await expect(page.getByText(/1 assigned;/)).toBeVisible();
    await expectAccessible(page, "assignment");
    await page.goto(`${path}/rankings`);
    await expectAccessible(page, "unscored ranking");
    await page.getByRole("button", { name: "Lock judging round" }).click();
    await expect(
      page.getByText("The round is not ready to lock.", { exact: false })
    ).toBeVisible();
    await expectAccessible(page, "refused lock");
    await judge.goto(judgePath);
    await expectAccessible(judge, "blind assignments");
    await expect(judge.getByRole("link", { name: unavailable })).toHaveCount(0);
    await judge.getByRole("link", { name: code }).click();
    await expectAccessible(judge, "blind entry");
    await expectAccessibleInDark(judge, "blind entry");
    await expect(
      judge.getByRole("img", { name: `Submitted work for entry ${code}` })
    ).toBeVisible();
    expect(await judge.content()).not.toContain("Kindness in our colony");
    const scores = judge.getByRole("spinbutton");
    for (const box of await scores.all()) await box.fill("8");
    await judge
      .getByLabel("Comments (optional)")
      .fill("Thoughtful use of colour");
    await judge.getByRole("button", { name: "Save changes" }).click();
    await expect(judge.getByText("Progress: Complete")).toBeVisible();
    await expect(judge.getByText("Saved.", { exact: true })).toBeVisible();
    await expectAccessible(judge, "complete score");
    await page.reload();
    await expect(page.getByText("80.00 / 100 · 1 sheet")).toBeVisible();
    await page.getByRole("button", { name: "Lock judging round" }).click();
    await expect(
      page.getByText("Round locked.", { exact: true })
    ).toBeVisible();
    await expectAccessible(page, "locked ranking");
    await expectAccessibleInDark(page, "locked ranking");
    const form = page.getByRole("form", { name: `Recognition for ${code}` });
    await form.getByLabel("Outcome and award").selectOption("special_mention");
    await form.getByLabel("Suitable for auction").check();
    await form.getByRole("button", { name: "Save recognition" }).click();
    await expect(
      page.getByText("Outcome saved.", { exact: true })
    ).toBeVisible();
    await expect(form.getByLabel("Outcome and award")).toHaveValue(
      "special_mention"
    );
    await expectAccessible(page, "tagged recognition");
    // The judge has not reloaded yet: an already-open editor must also
    // fail closed when its next autosave reaches the newly locked round.
    await judge.getByLabel("Comments (optional)").fill("Late edit");
    await expect(
      judge.getByText("This round is now locked. Your changes were not saved.")
    ).toBeVisible();
    judge.once("dialog", (dialog) => dialog.accept());
    await judge.reload();
    await expect(
      judge.getByText(
        "This round is locked. Your scores and comments can be read but not changed."
      )
    ).toBeVisible();
    await expect(
      judge.getByRole("button", { name: "Save changes" })
    ).toHaveCount(0);
    for (const box of await judge.getByRole("spinbutton").all())
      await expect(box).toHaveAttribute("readonly", "");
    await expect(judge.getByLabel("Comments (optional)")).toHaveValue(
      "Thoughtful use of colour"
    );
    await expectAccessible(judge, "read-only locked sheet");
  } finally {
    await judge.context().close();
  }
});
