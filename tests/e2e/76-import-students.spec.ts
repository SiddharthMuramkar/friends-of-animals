import { readFile } from "node:fs/promises";

import { expect, type Download, type Page } from "@playwright/test";

import {
  CLEAN_STUDENT_IMPORT_CSV_30,
  SAMPLE_STUDENT_IMPORT_CSV,
} from "../../src/server/seed/student-import-samples";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { freshEmail } from "./support/mailbox";
import { test } from "./support/seed-registration";
import { signInByCode } from "./support/sign-in";

// #76: a coordinator imports students from a CSV file. The authorised
// person of a fresh verified institution registers it for the seeded open
// competition, downloads the template, has a file with the wrong separator
// refused, imports the preview's sample (good rows enrolled, bad rows
// listed), downloads the rows to fix, fixes them and uploads that file
// again, then imports the clean 30-row file. Every state of the new page
// is checked with axe, light and dark. Who may import, the window's edges,
// duplicates against students already enrolled, atomicity and the audit
// rows need a fake clock and raw rows, so Seam 1 covers them
// (src/server/modules/registration/import-students.test.ts).

/** The seeded open competition (src/server/seed/competitions.ts). */
const OPEN = "Neighbours on My Street";

// One by one, in one worker: the journey writes the competition's rows.
test.describe.configure({ mode: "default" });

async function checkBothThemes(page: Page, label: string) {
  await expectAccessible(page, label);
  await expectAccessibleInDark(page, label);
}

async function downloaded(download: Download): Promise<string> {
  return readFile(await download.path(), "utf8");
}

async function upload(page: Page, name: string, text: string) {
  await page.getByLabel("CSV file").setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(text, "utf8"),
  });
  await page.getByRole("button", { name: "Import students" }).click();
}

/** The outcome of the last upload, in <main> (Next's route announcer is an alert too). */
function outcome(page: Page) {
  return page
    .getByRole("main")
    .getByRole("alert")
    .or(page.getByRole("main").getByRole("status"));
}

test("an authorised person imports students from a spreadsheet, fixes the rows that weren't enrolled and uploads them again", async ({
  page,
  request,
  seedVerifiedInstitution,
}, testInfo) => {
  const school = await seedVerifiedInstitution({
    adminName: "E2E Authorised Person",
    principalEmail: freshEmail(testInfo.project.name),
  });
  await signInByCode(page, request, school.adminEmail);
  await page.goto("/institution/competitions");
  const open = page.getByRole("article", { name: OPEN });
  await open
    .getByRole("button", { name: `Register ${school.name} for ${OPEN}` })
    .click();
  await open
    .getByRole("link", { name: `Students of ${school.name} in ${OPEN}` })
    .click();
  await expect(page.getByText("No students enrolled")).toBeVisible();

  await page
    .getByRole("link", { name: "Import students from a spreadsheet" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Import students" })
  ).toBeVisible();
  await expect(
    page.getByText("This competition is for ages 5–17 on 1 January 2027.")
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "What goes in each column" })
  ).toContainText("guardian_relationship");
  await checkBothThemes(page, "/institution/registrations/[ref]/import empty");

  const templateDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download the template" }).click();
  const template = await downloaded(await templateDownload);
  expect(template).toBe(
    "\uFEFFstudent_ref,full_name,date_of_birth,grade,guardian_name,guardian_relationship,guardian_phone,guardian_email,student_phone,student_email,address,pin_code,city,state\r\n"
  );

  await upload(
    page,
    "semicolons.csv",
    "full_name;date_of_birth\r\nTara Menon;2016-04-12\r\n"
  );
  await expect(outcome(page)).toContainText(
    "That file puts a semicolon between cells. Save it as CSV with commas."
  );
  await checkBothThemes(
    page,
    "/institution/registrations/[ref]/import refused file"
  );

  // Over Next's 1 MB Server Action body limit: refused in the browser, as
  // the server would refuse it before the action could say why.
  await upload(
    page,
    "too-big.csv",
    "full_name,date_of_birth\r\n" + "Tara Menon,2016-04-12\r\n".repeat(50_000)
  );
  await expect(outcome(page)).toContainText(
    "That file is over 750 KB. Split it into smaller files."
  );

  // The sample's five good rows, and Aarav Kulkarni: this institution
  // hasn't enrolled him yet.
  await upload(page, "sample.csv", SAMPLE_STUDENT_IMPORT_CSV);
  await expect(outcome(page)).toContainText(
    "6 students are enrolled. 4 rows need another look."
  );
  const problems = page.getByRole("table", { name: "Rows not enrolled" });
  await expect(problems.getByRole("row")).toHaveCount(5);
  await expect(
    problems.getByRole("row", { name: /^7 Myra Khan/ })
  ).toContainText("guardian_phone is empty");
  await expect(
    problems.getByRole("row", { name: /^8 Advik Menon/ })
  ).toContainText("date_of_birth: enter a real date");
  await expect(
    problems.getByRole("row", { name: /^9 Zoya Sheikh/ })
  ).toContainText(
    "this competition is for ages 5–17 on 1 January 2027; this student is 4."
  );
  await expect(problems.getByRole("row", { name: /^10 vihaan/ })).toContainText(
    "The same student as row 3"
  );
  await checkBothThemes(
    page,
    "/institution/registrations/[ref]/import partial"
  );

  const reportDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download the rows to fix" }).click();
  const report = await downloaded(await reportDownload);
  const lines = report.split("\r\n");
  expect(lines[0]).toBe(
    "\uFEFFstudent_ref,full_name,date_of_birth,grade,guardian_name,guardian_relationship,guardian_phone,guardian_email,row_number,problems"
  );
  expect(lines).toHaveLength(6);
  // Phones go out with a quote in front, so a spreadsheet won't run them.
  expect(report).toContain(",'+91 90000 07607,");

  const fixed = report
    .replace("parent,,salma.khan", "parent,90000 07606,salma.khan")
    .replace("31/02/2016", "28/02/2016");
  await upload(page, "students-to-fix.csv", fixed);
  // Zoya is still too young, and Vihaan, row 3's student, was enrolled by
  // the first upload.
  await expect(outcome(page)).toContainText(
    "2 students are enrolled. 2 rows need another look."
  );
  await expect(
    page
      .getByRole("table", { name: "Rows not enrolled" })
      .getByRole("row", { name: /vihaan/ })
  ).toContainText("This student is already enrolled.");

  await upload(page, "class-3.csv", CLEAN_STUDENT_IMPORT_CSV_30);
  await expect(outcome(page)).toContainText("All 30 students are enrolled.");
  await expect(
    page.getByRole("table", { name: "Rows not enrolled" })
  ).toHaveCount(0);
  await checkBothThemes(
    page,
    "/institution/registrations/[ref]/import success"
  );

  await page.getByRole("link", { name: "Back to students" }).click();
  await expect(page.getByText("38 students enrolled")).toBeVisible();
});
