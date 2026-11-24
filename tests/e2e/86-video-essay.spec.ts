import {
  closeSync,
  openSync,
  ftruncateSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { SEED_ACCOUNTS } from "../../src/server/seed/accounts";
import { readMediaFixture } from "../../src/test/media-fixtures";
import {
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { nonceOf, onlyPolicy } from "./support/csp";
import { signInByCode } from "./support/sign-in";

// #86: Ravi's seeded entries (src/server/seed/entries.ts): a submitted
// video on ROOF27 and a submitted typed essay on BIRDS27. The video plays
// from its transcoded copy with its poster, and its replacement form checks
// a clip before uploading it; the essay shows as text, and its replacement
// form counts words as they are typed and saves a new essay at once.

// Both journeys sign Ravi in by email code; a second code for the same
// address replaces the first, so they run one after the other.
test.describe.configure({ mode: "serial" });

const ENTRIES = "/participant/entries";
const VIDEO = `${ENTRIES}/ROOF27-E-5EEDB1`;
const ESSAY = `${ENTRIES}/BIRDS27-E-5EEDB2`;
const RAVI = SEED_ACCOUNTS.members[1].email;
const MB = 1024 * 1024;

test("a participant watches their submitted video and checks a replacement before it uploads", async ({
  page,
  request,
}, testInfo) => {
  await signInByCode(page, request, RAVI);
  await expectRendersAccessibly(page, ENTRIES);
  for (const code of ["ROOF27-E-5EEDB1", "BIRDS27-E-5EEDB2"]) {
    await expect(
      page.getByRole("main").getByRole("listitem").filter({ hasText: code })
    ).toContainText("Submitted");
  }

  const policy = await onlyPolicy(await page.goto(VIDEO), VIDEO);
  expect(nonceOf(policy)).toBeTruthy();
  expect(policy).toMatch(/media-src [^;]*blob:/);
  await expectRendersAccessibly(page, VIDEO);
  const video = page.getByRole("main").locator("video");
  await expect(video).toHaveAttribute(
    "aria-label",
    "Submitted video for Pigeons at the water tank"
  );
  await expect(video).toHaveAttribute("controls", "");
  const poster = await video.getAttribute("poster");
  const source = await video.locator("source").getAttribute("src");
  expect(poster).toBeTruthy();
  expect(source).toBeTruthy();
  // The copy and its poster are served from their signed URLs; the
  // original is never offered.
  const copy = await request.get(source!);
  expect(copy.status()).toBe(200);
  expect(copy.headers()["content-type"]).toBe("video/mp4");
  const still = await request.get(poster!);
  expect(still.headers()["content-type"]).toBe("image/jpeg");
  await expectAccessibleInDark(page, VIDEO);

  await expect(
    page.getByRole("heading", { level: 2, name: "Replace video" })
  ).toBeVisible();
  const file = page.getByLabel("Choose a video");
  await expect(file).toHaveAttribute("accept", /\.mov/);
  await expect(file).toHaveAccessibleDescription(
    "MP4, MOV, 3GP or WebM. Up to 200 MB and 3 minutes."
  );
  const uploads: string[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "PUT") uploads.push(new URL(sent.url()).pathname);
  });
  await file.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("notes"),
  });
  await expect(file).toHaveAccessibleDescription(/listed file types/);
  const dir = mkdtempSync(join(tmpdir(), "foa-86-"));
  try {
    // A sparse file one byte over the limit: no need to write 200 MB.
    const large = join(dir, `large-${testInfo.project.name}.mp4`);
    const handle = openSync(large, "w");
    ftruncateSync(handle, 200 * MB + 1);
    closeSync(handle);
    await file.setInputFiles(large);
    await expect(file).toHaveAccessibleDescription(
      /video is larger than the listed limit/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  expect(uploads).toEqual([]);

  await file.setInputFiles({
    name: "IMG_0042.MOV",
    mimeType: "video/quicktime",
    buffer: Buffer.from(readMediaFixture("gpsMov")),
  });
  await page.getByRole("button", { name: "Upload replacement video" }).click();
  await expect(
    page.getByText(
      "Your current video stays submitted while we check its replacement."
    )
  ).toBeVisible();
  expect(uploads).toHaveLength(1);
  await expect(page.getByRole("main").locator("video")).toBeVisible();
  await expectAccessibleInDark(page, `${VIDEO} with a replacement`);
});

test("a participant reads their typed essay and replaces it with new text", async ({
  page,
  request,
}, testInfo) => {
  await signInByCode(page, request, RAVI);
  await expectRendersAccessibly(page, ESSAY);
  const essay = page.getByRole("region", { name: "Essay" });
  await expect(essay.getByRole("paragraph")).not.toHaveCount(0);
  await expectAccessibleInDark(page, ESSAY);

  await expect(
    page.getByRole("heading", { level: 2, name: "Replace essay" })
  ).toBeVisible();
  const typed = page.getByRole("radio", { name: "Type it here" });
  await expect(typed).toBeChecked();
  const text = page.getByRole("textbox", { name: "Your essay" });
  await expect(text).not.toHaveValue("");
  await expect(text).toHaveAccessibleDescription(
    "Up to 1,500 words. Leave a blank line between paragraphs."
  );
  const count = page.getByText(/of 1,500 words$/);
  await expect(count).toBeVisible();

  const tooMany = Array.from({ length: 1501 }, (_, at) => `w${at}`).join(" ");
  await text.fill(tooMany);
  await expect(count).toHaveText("1501 of 1,500 words");
  const save = page.getByRole("button", { name: "Save new essay" });
  await save.click();
  await expect(text).toHaveAccessibleDescription(/over the word limit/);
  await expect(text).toBeFocused();

  // Markup a participant types stays the text they typed.
  const written = `Our bowl ${testInfo.project.name}: <b>full</b> again.`;
  await text.fill(`${written}\n\nThe sparrows came at four.`);
  await expect(count).toHaveText("10 of 1,500 words");
  await save.click();
  await expect(page).toHaveURL(new RegExp(`${ESSAY}$`));
  await expect(
    page.getByRole("region", { name: "Essay" }).getByText(written)
  ).toBeVisible();
  await expect(page.getByRole("main").locator("b")).toHaveCount(0);
  await expectAccessibleInDark(page, `${ESSAY} replaced`);

  await page.getByRole("radio", { name: "Upload a PDF" }).check();
  const pdf = page.getByLabel("Choose a PDF");
  await expect(pdf).toHaveAccessibleDescription("PDF. Up to 10 MB.");
  await expect(text).toHaveCount(0);
});
