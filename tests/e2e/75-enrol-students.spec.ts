import { expect, type Page } from "@playwright/test";

import { SEED_INSTITUTIONS } from "../../src/server/seed/institutions";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { freshEmail } from "./support/mailbox";
import { signInByCode } from "./support/sign-in";
import { test } from "./support/seed-registration";

// #75: a coordinator enrols students. A coordinator of the seeded
// institution sees the seeded registration's students; the authorised
// person of a fresh verified institution registers it, adds a student
// after fixing the form's mistakes and a student too old for the
// competition, then withdraws them. Every state of both new pages is
// checked with axe, light and dark. Age boundaries, duplicates,
// encryption, the window's edges and who may enrol need a fake clock and
// raw rows, so Seam 1 covers them (src/server/modules/registration/enrol-student.test.ts and
// enrolled-students.test.ts).

/** The seeded open competition (src/server/seed/competitions.ts). */
const OPEN = "Neighbours on My Street";

// One by one, in one worker: both journeys read the same competition's
// rows, and the fresh institution's journey writes them.
test.describe.configure({ mode: "default" });

async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `HTTP status of ${path}`).toBeLessThan(400);
}

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

function student(page: Page, name: string) {
  return page.getByRole("article", { name });
}

test("a coordinator sees the seeded registration's students and their status", async ({
  page,
  request,
  seedAccount,
}) => {
  // An account of its own, not the seeded member 1:
  // 75-institution-registration.spec.ts signs member 1 in from another
  // worker at the same time, and each code request replaces the other's
  // code, so one of the two sign-ins failed.
  const coordinator = await seedAccount({
    name: "E2E Coordinator",
    grants: [
      {
        role: "institution_coordinator",
        scope: { type: "institution", id: SEED_INSTITUTIONS.verified.id },
      },
    ],
  });
  await signInByCode(page, request, coordinator);
  await visit(page, "/institution/competitions");
  await page
    .getByRole("article", { name: OPEN })
    .getByRole("link", { name: `Students of Seed Public School in ${OPEN}` })
    .click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Students" })
  ).toBeVisible();
  // Exact: Next keeps the competitions page, which shows the reference
  // too, mounted and hidden after the click.
  await expect(
    page.getByText("Registration reference NEIGH27-I-5EED1", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("6 students enrolled, 1 withdrawn")
  ).toBeVisible();
  await expect(
    student(page, "Aarav Kulkarni").getByText("Enrolled")
  ).toBeVisible();
  await expect(
    student(page, "Rohan Patil").getByText("Withdrawn")
  ).toBeVisible();
  await expect(student(page, "Rohan Patil").getByRole("button")).toHaveCount(0);
  // Names only: no date of birth or contact on the list.
  await expect(page.getByText("2019-03-14")).toHaveCount(0);
  await expect(page.getByText("@example.test")).toHaveCount(0);
  await checkBothThemes(page, "/institution/registrations/[ref] filled");
});

test("an authorised person enrols a student, fixing the form, and withdraws them", async ({
  page,
  request,
  seedVerifiedInstitution,
}, testInfo) => {
  const school = await seedVerifiedInstitution({
    adminName: "E2E Authorised Person",
    principalEmail: freshEmail(testInfo.project.name),
  });
  await signInByCode(page, request, school.adminEmail);
  await visit(page, "/institution/competitions");
  const open = page.getByRole("article", { name: OPEN });
  await open
    .getByRole("button", { name: `Register ${school.name} for ${OPEN}` })
    .click();
  await open
    .getByRole("link", { name: `Students of ${school.name} in ${OPEN}` })
    .click();

  await expect(page.getByText("No students enrolled")).toBeVisible();
  await expect(
    page.getByText("No students yet. Add each student who takes part.")
  ).toBeVisible();
  await checkBothThemes(page, "/institution/registrations/[ref] empty");

  await page.getByRole("link", { name: "Add a student" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Add a student" })
  ).toBeVisible();
  await expect(
    // Its children's groups and, for adults on their own (#78), Adults.
    page.getByText("This competition is for ages 5–99 on 1 January 2027.")
  ).toBeVisible();
  await checkBothThemes(
    page,
    "/institution/registrations/[ref]/students/new blank"
  );

  const submit = page.getByRole("button", { name: "Add student" });
  await submit.click();
  // In <main>: Next's route announcer is an alert too.
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Some details need another look."
  );
  await expect(page.getByText("Enter the student's full name.")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Full name" })
  ).toHaveAttribute("aria-invalid", "true");
  await checkBothThemes(
    page,
    "/institution/registrations/[ref]/students/new with errors"
  );

  const fill = (name: string, value: string) =>
    page.getByRole("textbox", { name, exact: true }).fill(value);
  // 3 on the competition's cut-off date: too young for every age group.
  await fill("Full name", "Vikram Rao");
  await page.getByLabel("Date of birth").fill("2023-03-10");
  await fill("Parent or guardian's name", "Asha Menon");
  await page.getByRole("radio", { name: "Parent" }).check();
  await fill("Parent or guardian's mobile number", "90000 05191");
  await submit.click();
  await expect(
    page.getByText(
      "This competition is for ages 5–99 on 1 January 2027; this student is 3."
    )
  ).toBeVisible();
  await checkBothThemes(
    page,
    "/institution/registrations/[ref]/students/new outside the ages"
  );

  await fill("Full name", "Tara Menon");
  await page.getByLabel("Date of birth").fill("2016-04-12");
  await fill("Student's mobile number", "");
  await fill("Parent or guardian's name", "Asha Menon");
  await page.getByRole("radio", { name: "Parent" }).check();
  await fill("Parent or guardian's mobile number", "90000 05191");
  await submit.click();

  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Tara Menon is enrolled in the Group B age group." })
  ).toBeVisible();
  await expect(page.getByText("1 student enrolled")).toBeVisible();
  await expect(student(page, "Tara Menon").getByText("Enrolled")).toBeVisible();

  await student(page, "Tara Menon")
    .getByRole("button", { name: "Withdraw Tara Menon" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "The student is withdrawn." })
  ).toBeVisible();
  await expect(
    student(page, "Tara Menon").getByText("Withdrawn")
  ).toBeVisible();
  await checkBothThemes(page, "/institution/registrations/[ref] withdrawn");
});
