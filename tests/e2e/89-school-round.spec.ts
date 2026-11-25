import { expect } from "@playwright/test";

import { SEED_COORDINATORS } from "../../src/server/seed/coordinators";
import { SEED_SCHOOL_ROUND } from "../../src/server/seed/school-round";
import { SEED_SCOPES } from "../../src/server/seed/scopes";
import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { test } from "./support/seed-school-round";
import { signInByCode } from "./support/sign-in";

// #89's Seam 2 journey. The seeded school's coordinator opens Kinder
// Skies' school round (seeded open, with a panel and picks), saves the
// panel, is told why a shortlist with two entries in one position can't be
// saved, and saves it as it was: every save leaves the seeded round as it
// is, so the desktop and mobile projects can share one database. Finalising
// is a fresh institution's round (seedFinalisableRound), so the seeded one
// stays open. Each state is checked with axe, light and dark. Moving the
// entries and telling families are Seam 1's.

const ROUND = `/institution/registrations/${SEED_SCHOOL_ROUND.reference}/school-round?institution=${SEED_SCOPES.institution.id}`;

test("a coordinator records the panel and picks the shortlist", async ({
  page,
  request,
}) => {
  await signInByCode(page, request, SEED_COORDINATORS.coordinator.email);

  await expectRendersAccessibly(page, ROUND);
  const main = page.getByRole("main");
  await expect(
    main.getByText("Kinder Skies", { exact: false }).first()
  ).toBeVisible();
  await expect(main.getByLabel("Full name").first()).toHaveValue(
    "Lata Kulkarni"
  );

  // The panel, saved as it is.
  const panel = main.getByRole("region", { name: "Judging panel" });
  await panel.getByRole("button", { name: "Save panel" }).click();
  await expect(main.getByText("The panel is saved.")).toBeVisible();

  // Two entries in first place: refused, with the entry named.
  const second = main.getByLabel("School position for SKIES26-E-5EEDS2");
  await expect(main.getByLabel("Shortlist SKIES26-E-5EEDS1")).toBeChecked();
  await expect(main.getByLabel("Shortlist SKIES26-E-5EEDS2")).toBeChecked();
  await second.selectOption("1");
  const category = main.getByRole("region", { name: "Drawing · Group A" });
  await category.getByRole("button", { name: "Save shortlist" }).click();
  await expect(
    main.getByText(
      "SKIES26-E-5EEDS2: another entry already holds that position."
    )
  ).toBeVisible();
  await expect(
    main.getByLabel("School position for SKIES26-E-5EEDS2")
  ).toHaveValue("");

  // Saved as seeded.
  await category.getByRole("button", { name: "Save shortlist" }).click();
  await expect(main.getByText("The shortlist is saved.")).toBeVisible();

  // The finalise checklist (conduct is #87's journey's to certify).
  await expect(
    main.getByRole("heading", { name: "Before you finalise" })
  ).toBeVisible();
  await expectAccessibleInDark(page, ROUND);
});

test("a coordinator attests the judging and finalises the round", async ({
  page,
  request,
  seedFinalisableRound,
}) => {
  const round = await seedFinalisableRound();
  const path = `/institution/registrations/${round.reference}/school-round?institution=${round.institutionId}`;
  await signInByCode(page, request, round.adminEmail);

  await expectRendersAccessibly(page, path);
  const main = page.getByRole("main");
  await main.getByLabel("I confirm the statement above").check();
  await main.getByRole("button", { name: "Finalise school round" }).click();

  await expect(
    main.getByText(
      "Your school round is finalised. Families are being told the outcome."
    )
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Your shortlist" })
  ).toBeVisible();
  await expect(main.getByText("No entry was shortlisted.")).toBeVisible();
  await expect(main.getByRole("button", { name: "Save panel" })).toHaveCount(0);
  await expectRendersAccessibly(page, path);
  await expectAccessibleInDark(page, path);
});
