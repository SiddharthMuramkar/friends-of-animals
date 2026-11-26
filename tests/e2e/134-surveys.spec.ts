import { expect, type Page } from "@playwright/test";
import { test } from "./support/seed-account";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import {
  expectNoSidewaysScrollAt320,
  newDevice,
  signInByCode,
} from "./support/sign-in";
import { drainOutbox, readEmail } from "./support/mailbox";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_FEEDBACK } from "../../src/server/seed/surveys";
import { SEED_AUCTIONS } from "../../src/server/seed/auctions";

async function check(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
  await expectNoSidewaysScrollAt320(page, label);
}

test("managers send after publication; private feedback link and dashboard share one answer", async ({
  page,
  request,
  browser,
  seedAccount,
}, info) => {
  const secret = generateTotpSecret();
  const manager = await seedAccount({
    name: `Feedback manager ${info.project.name}`,
    grants: [
      {
        role: "competition_manager",
        scope: { type: "competition", id: SEED_FEEDBACK.competitionId },
      },
    ],
    totpSecret: secret,
  });
  await signInByCode(page, request, manager);
  await page.goto("/admin/surveys");
  await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
  await page
    .getByRole("textbox", { name: "6-digit code" })
    .fill(totpCode(secret, new Date()));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Competition feedback surveys" })
  ).toBeVisible();
  await check(page, "survey admin list");
  await page.getByRole("link", { name: /AUCT27/ }).click();
  await expect(page.getByRole("textbox", { name: "Survey title" })).toHaveValue(
    SEED_FEEDBACK.title
  );
  await check(page, "survey builder");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.getByRole("button", { name: "Send survey invitations" }).click();
  await expect(page.getByText("Survey invitations queued.")).toBeVisible();
  await check(page, "survey aggregate results");
  await drainOutbox(request);
  const artist =
    info.project.name === "mobile"
      ? SEED_AUCTIONS.mobileArtist
      : SEED_AUCTIONS.artist;
  const message = await readEmail(
    request,
    artist.email,
    "Competition feedback"
  );
  const token = message.text.match(/\/feedback\/([0-9a-f]{64})/)?.[1];
  if (!token) throw Error("No survey link");
  const respondent = await newDevice(browser, info);
  const visitor = await newDevice(browser, info);
  try {
    await signInByCode(respondent, request, artist.email);
    await respondent.goto("/dashboard/surveys");
    await expect(
      respondent.getByRole("link", { name: `Answer ${SEED_FEEDBACK.title}` })
    ).toBeVisible();
    await check(respondent, "dashboard surveys");
    await respondent
      .getByRole("link", { name: `Answer ${SEED_FEEDBACK.title}` })
      .click();
    await expect(
      respondent.getByRole("group", { name: SEED_FEEDBACK.questions[0]!.text })
    ).toBeVisible();
    await check(respondent, "dashboard answer form");
    const response = await visitor.goto(`/feedback/${token}`);
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(
      visitor.getByRole("heading", { name: SEED_FEEDBACK.title })
    ).toBeVisible();
    await check(visitor, "private bearer feedback form");
    await visitor.getByRole("radio", { name: "Excellent" }).check();
    await visitor.getByRole("radio", { name: "Yes" }).check();
    await visitor.getByRole("button", { name: "Submit feedback" }).click();
    await expect(
      visitor.getByText("Thank you for sharing your feedback.")
    ).toBeVisible();
    await check(visitor, "private bearer feedback completion");
    await respondent.reload();
    await expect(
      respondent.getByText(
        "This survey is not available, has closed, or has already been answered."
      )
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Responses: 1/)).toBeVisible();
    await expect(page.getByText("Excellent: 1")).toBeVisible();
    const csv = await page.request.get(
      `/admin/surveys/export.csv?competitionId=${SEED_FEEDBACK.competitionId}`
    );
    expect(csv.ok()).toBeTruthy();
    const body = await csv.text();
    expect(body).toContain("Excellent,1");
    expect(body).not.toContain(artist.email);
    expect(body).not.toContain(token);
  } finally {
    await respondent.context().close();
    await visitor.context().close();
  }
});
