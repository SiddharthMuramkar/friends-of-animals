import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

type ExportQueue = { count: () => number; finish: () => void };

test("a pledge exports only the current card, even while a previous PNG is encoding", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "toBlob"
    )!.value as (
      this: HTMLCanvasElement,
      ...args: Parameters<HTMLCanvasElement["toBlob"]>
    ) => void;
    const pending: (() => void)[] = [];
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      original.call(
        this,
        (blob) => pending.push(() => callback(blob)),
        type,
        quality
      );
    };
    Object.defineProperty(window, "pledgeExports", {
      value: {
        count: () => pending.length,
        finish: () => pending.shift()?.(),
      },
    });
  });
  const count = () =>
    page.evaluate(() =>
      (
        window as unknown as { pledgeExports: ExportQueue }
      ).pledgeExports.count()
    );
  const finish = () =>
    page.evaluate(() =>
      (
        window as unknown as { pledgeExports: ExportQueue }
      ).pledgeExports.finish()
    );

  await page.goto("/awareness");
  const pledge = page.locator("#pledge");
  const download = pledge.getByRole("button", { name: "Download my card" });
  const name = pledge.getByRole("textbox", {
    name: "Your first name or nickname",
  });
  await expect.poll(count).toBe(1);
  await expect(download).toBeDisabled();
  await finish();
  await expect(download).toBeEnabled();

  await name.fill("Aarav");
  await expect.poll(count).toBe(1);
  await expect(download).toBeDisabled();
  await name.fill("Riya");
  await expect.poll(count).toBe(2);
  await finish();
  await expect(download).toBeDisabled();
  await finish();
  await expect(download).toBeEnabled();

  const preview = await pledge
    .locator("canvas")
    .evaluate(
      (canvas: HTMLCanvasElement) =>
        canvas.toDataURL("image/png").split(",")[1]!
    );
  const saving = page.waitForEvent("download");
  await download.click();
  const saved = await saving;
  expect(saved.suggestedFilename()).toBe("foa-kindness-pledge.png");
  expect(await readFile(await saved.path())).toEqual(
    Buffer.from(preview, "base64")
  );
});

test.describe("before JavaScript runs", () => {
  test.use({ javaScriptEnabled: false });

  test("pressing Enter in the pledge name never submits it", async ({
    page,
  }) => {
    await page.goto("/awareness");
    const name = page.getByRole("textbox", {
      name: "Your first name or nickname",
    });
    await name.fill("Riya");
    await name.press("Enter");
    await expect(page).toHaveURL("/awareness");
    await expect(name).toHaveValue("Riya");
  });
});
