import { expect } from "@playwright/test";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_SCHOOL_ROUND } from "../../src/server/seed/school-round";
import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { test } from "./support/seed-school-round";
import { signInByCode } from "./support/sign-in";

test("a competition manager closes an overdue school round with a reason and reopens it", async ({
  page,
  request,
  seedAccount,
  seedFinalisableRound,
}) => {
  const round = await seedFinalisableRound({ overdue: true });
  // A second unfinished school keeps the competition in school judging,
  // where a manager may reopen the first round.
  await seedFinalisableRound({ overdue: true });
  const path = `/admin/competitions/${SEED_SCHOOL_ROUND.competitionId}/school-rounds`;
  const secret = generateTotpSecret();
  const email = await seedAccount({
    name: "Round Manager",
    grants: [
      {
        role: "competition_manager",
        scope: { type: "competition", id: SEED_SCHOOL_ROUND.competitionId },
      },
    ],
    totpSecret: secret,
  });
  await signInByCode(page, request, email);
  await page.goto(path);
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expectRendersAccessibly(page, path);
  const school = page.getByRole("region").filter({ hasText: round.reference });
  await expect(school.getByText("Overdue", { exact: true })).toBeVisible();
  await school
    .getByLabel("Reason (required)")
    .fill("The school requested assistance.");
  await school
    .getByRole("button", { name: "Close on the school’s behalf" })
    .click();
  await expect(
    page.getByText("School round closed on the school’s behalf.")
  ).toBeVisible();
  await expect(
    school.getByText("Closed by FOA", { exact: true })
  ).toBeVisible();
  await expect(
    school.getByText("Recorded reason: The school requested assistance.")
  ).toBeVisible();
  await school.getByRole("button", { name: "Reopen school round" }).click();
  await expect(page.getByText("School round reopened.")).toBeVisible();
  await expect(
    school.getByRole("button", { name: "Reopen school round" })
  ).toHaveCount(0);
  await expectAccessibleInDark(page, path);
});
