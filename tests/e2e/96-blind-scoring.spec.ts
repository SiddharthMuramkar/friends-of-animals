import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { SEED_SCORING } from "../../src/server/seed/scoring";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { signInByCode, expectNoSidewaysScrollAt320 } from "./support/sign-in";
const round = `/judge/rounds/${SEED_SCORING.roundId}`;
const path = (index: number) =>
  `${round}/entries/${SEED_SCORING.entryCodes[index]}`;

test.describe.configure({ mode: "serial" });

test("judges see assigned work and inspect the derived image", async ({
  page,
  request,
}, testInfo) => {
  const judge =
    SEED_SCORING.judges[testInfo.project.name === "mobile" ? 1 : 0]!.email;
  await signInByCode(page, request, judge);
  await expectRendersAccessibly(page, "/judge");
  await page
    .getByRole("link", {
      name: "View assigned entries for Sample digital judging",
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`${round}$`));
  await expectAccessible(page, "assigned entries");
  await expectAccessibleInDark(page, "assigned entries");
  await expectNoSidewaysScrollAt320(page, "assigned entries");
  const main = page.getByRole("main");
  for (const [index, status] of [
    "Not started",
    "In progress",
    "Complete",
  ].entries()) {
    const row = main
      .getByRole("listitem")
      .filter({ hasText: SEED_SCORING.entryCodes[index] });
    await expect(row).toContainText(status);
  }
  for (const privateText of [
    "Nisha Sample",
    "Kabir Sample",
    "Anita Sample",
    "Cool shade",
    "A water bowl",
    "Sharing our street",
    "JURY27-R-",
  ])
    expect(await page.content()).not.toContain(privateText);
  await main
    .getByLabel("Progress", { exact: true })
    .selectOption("in_progress");
  await main.getByRole("button", { name: "Filter entries" }).click();
  await expect(
    main.getByRole("link", { name: SEED_SCORING.entryCodes[1] })
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: SEED_SCORING.entryCodes[0] })
  ).toHaveCount(0);
  await main.getByLabel("Progress", { exact: true }).selectOption("");
  await main.getByRole("button", { name: "Filter entries" }).click();
  await main.getByRole("link", { name: SEED_SCORING.entryCodes[0] }).click();
  await expect(page).toHaveURL(new RegExp(`${path(0)}$`));
  await expectAccessible(page, "score image");
  await expectAccessibleInDark(page, "score image");
  await expectNoSidewaysScrollAt320(page, "score image");
  const image = main.getByRole("img", {
    name: `Submitted work for entry ${SEED_SCORING.entryCodes[0]}`,
  });
  const imageUrl = await image.getAttribute("src");
  expect(imageUrl).toContain("display_1600.webp");
  expect((await request.get(imageUrl!)).headers()["content-type"]).toBe(
    "image/webp"
  );
  const open = page.getByRole("button", { name: "View full screen" });
  await open.click();
  const viewer = page.getByRole("dialog", { name: "Full-screen work viewer" });
  await expect(viewer).toBeVisible();
  const size = await viewer.boundingBox();
  expect(size?.width).toBeCloseTo(page.viewportSize()!.width, 0);
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(viewer.getByText("150% zoom")).toBeVisible();
  await page.keyboard.press("+");
  await expect(viewer.getByText("200% zoom")).toBeVisible();
  if (testInfo.project.name === "desktop") {
    const expanded = viewer.getByRole("img");
    const before = await expanded.getAttribute("style");
    const { width, height } = page.viewportSize()!;
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.down();
    await page.mouse.move(width / 2 + 80, height / 2 + 50, { steps: 4 });
    await page.mouse.up();
    await expect(expanded).not.toHaveAttribute("style", before!);
  }
  await page.keyboard.press("-");
  await expect(viewer.getByText("150% zoom")).toBeVisible();
  await page.keyboard.press("0");
  await expect(viewer.getByText("100% zoom")).toBeVisible();
  if (testInfo.project.name === "mobile") {
    // Real touch input on the Pixel project, not an event handler unit test.
    const cdp = await page.context().newCDPSession(page);
    const { width, height } = page.viewportSize()!;
    const x = width / 2,
      y = height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: x - 30, y, id: 1 },
        { x: x + 30, y, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x - 60, y, id: 1 },
        { x: x + 60, y, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
    await expect(viewer.getByText("200% zoom")).toBeVisible();
    await viewer.getByRole("button", { name: "Fit image" }).click();
    await expect(viewer.getByText("100% zoom")).toBeVisible();
  }
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle("dark", dark),
      theme === "dark"
    );
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(
      violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
      `viewer (${theme})`
    ).toEqual([]);
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.keyboard.press("Escape");
  await expect(viewer).not.toBeVisible();
  await expect(open).toBeFocused();
});

test("judges play the derived video and read the typed essay", async ({
  page,
  request,
}, testInfo) => {
  const judge =
    SEED_SCORING.judges[testInfo.project.name === "mobile" ? 1 : 0]!.email;
  await signInByCode(page, request, judge);
  await page.goto(path(1));
  const main = page.getByRole("main");
  await expectAccessible(page, "score video");
  await expectAccessibleInDark(page, "score video");
  const video = main.locator("video");
  await expect(video).toHaveAttribute("controls", "");
  await expect(video).toHaveAttribute("playsinline", "");
  await expect(video).toHaveAttribute("preload", "metadata");
  const source = await video.locator("source").getAttribute("src");
  expect(source).toContain("video_mp4.mp4");
  expect((await request.get(source!)).headers()["content-type"]).toBe(
    "video/mp4"
  );
  expect(
    (await request.get((await video.getAttribute("poster"))!)).headers()[
      "content-type"
    ]
  ).toBe("image/jpeg");
  // The CI bundled Chromium may omit the proprietary H.264 decoder (#86).
  // On builds which support it, prove playback as well as delivery.
  const canPlay = await video.evaluate((node) =>
    (node as HTMLVideoElement).canPlayType('video/mp4; codecs="avc1.42E01E"')
  );
  if (canPlay) {
    await video.evaluate(async (node) => {
      const clip = node as HTMLVideoElement;
      clip.muted = true;
      await clip.play();
    });
    await expect
      .poll(async () =>
        video.evaluate((node) => (node as HTMLVideoElement).currentTime)
      )
      .toBeGreaterThan(0);
  }
  await main.getByRole("link", { name: "Next entry" }).click();
  await expect(page).toHaveURL(new RegExp(`${path(2)}$`));
  await expect(
    main.getByText("A bowl outside our door", { exact: false })
  ).toBeVisible();
  await expectAccessible(page, "score essay");
  await expectAccessibleInDark(page, "score essay");
});

test("saves score patches automatically and through a no-JavaScript form", async ({
  page,
  request,
  browser,
}, testInfo) => {
  const judge =
    SEED_SCORING.judges[testInfo.project.name === "mobile" ? 1 : 0]!.email;
  await signInByCode(page, request, judge);
  await page.goto(path(0));
  const main = page.getByRole("main");
  const score = main.getByRole("spinbutton").first();
  await score.fill("7");
  await main.getByLabel("Comments (optional)").fill("Thoughtful composition");
  await expect(main.getByText("Saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(main.getByRole("spinbutton").first()).toHaveValue("7");
  await expect(main.getByLabel("Comments (optional)")).toHaveValue(
    "Thoughtful composition"
  );
  for (const privateText of [
    "Nisha Sample",
    "Cool shade",
    "A drawing of street dogs resting in shade.",
    "JURY27-R-",
  ])
    expect(await page.content()).not.toContain(privateText);
  // Leaving immediately still flushes the last draft before navigation.
  await main.getByLabel("Comments (optional)").fill("Review this one again");
  await main.getByRole("link", { name: "Next entry" }).click();
  await expect(page).toHaveURL(new RegExp(`${path(1)}$`));
  await main.getByRole("link", { name: "Previous entry" }).click();
  await expect(page).toHaveURL(new RegExp(`${path(0)}$`));
  await expect(main.getByLabel("Comments (optional)")).toHaveValue(
    "Review this one again"
  );
  // Progressive enhancement: a same-session browser with JS entirely off
  // posts the native Save form and a subsequent sitting sees its change.
  const fallback = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    storageState: await page.context().storageState(),
    javaScriptEnabled: false,
    viewport: testInfo.project.use.viewport,
  });
  try {
    const noJs = await fallback.newPage();
    await noJs.goto("/judge");
    await noJs
      .getByRole("link", {
        name: "View assigned entries for Sample digital judging",
      })
      .click();
    await noJs.getByRole("link", { name: SEED_SCORING.entryCodes[0] }).click();
    await noJs
      .getByLabel("Comments (optional)")
      .fill("Saved without JavaScript");
    await noJs.getByRole("button", { name: "Save changes" }).click();
    await expect(noJs.getByText("Saved.", { exact: true })).toBeVisible();
  } finally {
    await fallback.close();
  }
  await page.reload();
  await expect(main.getByLabel("Comments (optional)")).toHaveValue(
    "Saved without JavaScript"
  );
});
