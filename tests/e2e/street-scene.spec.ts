import { expect, type Page, test } from "@playwright/test";

// "Spot the neighbour" on /awareness: each ring in the street picture links
// to its neighbour's card. Its name shows on keyboard focus (and on hover
// once the picture is wide enough), never over another ring, can be hovered
// itself, and Escape hides it (WCAG 1.4.13).

async function openScene(page: Page) {
  await page.goto("/awareness");
  // HeaderHeightSync writes the measured height after hydration; the jump
  // and Escape need the page's script. React reveals streamed parts on a
  // timer after that.
  await expect(page.locator("html")).toHaveAttribute(
    "style",
    /--header-height:/
  );
  await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0);
  return page.getByRole("list", { name: "Neighbours in the picture" });
}

for (const turned of [false, true]) {
  test(`Tab reaches a ring, and Enter focuses its card${turned ? " when turned" : ""}`, async ({
    page,
  }) => {
    const scene = await openScene(page);
    const ring = scene.getByRole("link", { name: "Rock pigeon" });
    const name = ring.locator("span");
    const card = page.getByRole("group", { name: "Rock pigeon" });

    if (turned) {
      // Its front face, title included, is inert while turned.
      const turn = card.getByRole("button", {
        name: "How to be a good neighbour to the Rock pigeon",
      });
      await turn.click();
      await expect(turn).toHaveAttribute("aria-pressed", "true");
      await expect(card.locator("[inert] article")).toHaveCount(1);
    }

    // From the start of the section, the first Tab reaches the first ring.
    // The section is focused directly, as the "Street neighbours" jump
    // would: the jump also updates the URL, and the router commits that a
    // moment later in a view transition, when React puts focus back where it
    // was, undoing a Tab pressed in between.
    const section = page.locator("#neighbours");
    await section.evaluate((element) => {
      element.tabIndex = -1;
      element.focus();
    });
    await page.keyboard.press("Tab");
    await expect(ring).toBeFocused();
    await expect(name).toHaveCSS("opacity", "1");
    await page.keyboard.press("Escape");
    await expect(name).toHaveCSS("opacity", "0");
    await expect(ring).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(card).toBeFocused();
    await expect(card).toHaveAttribute("id", "neighbour-rock-pigeon");
    await expect(card).toBeInViewport();
  });
}

for (const width of [768, 1280]) {
  test(`at ${width}px a hovered ring's name covers no other ring, stays while hovered, and Escape hides it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const scene = await openScene(page);
    await scene.evaluate((list) =>
      list.scrollIntoView({ block: "center", behavior: "instant" })
    );
    const rings = scene.getByRole("link");
    const count = await rings.count();
    expect(count).toBe(10);

    for (let i = 0; i < count; i++) {
      const ring = rings.nth(i);
      const label = (await ring.textContent()) ?? "";
      const name = ring.locator("span");
      await ring.hover();
      await expect(name, label).toHaveCSS("opacity", "1");
      // Every other ring still takes the pointer at its centre, and the
      // name's box stays clear of its circle.
      const covered = await scene.evaluate((list, shown) => {
        const box = [...list.querySelectorAll("a")]
          .find((a) => a.textContent === shown)!
          .querySelector("span")!
          .getBoundingClientRect();
        return [...list.querySelectorAll("a")]
          .filter((a) => a.textContent !== shown)
          .filter((a) => {
            const r = a.getBoundingClientRect();
            const x = r.x + r.width / 2;
            const y = r.y + r.height / 2;
            const nearX = Math.max(box.left, Math.min(x, box.right));
            const nearY = Math.max(box.top, Math.min(y, box.bottom));
            return (
              document.elementFromPoint(x, y)?.closest("a") !== a ||
              Math.hypot(nearX - x, nearY - y) < r.width / 2
            );
          })
          .map((a) => a.textContent);
      }, label);
      expect(covered, `rings under the name ${label}`).toEqual([]);

      // Onto the middle of the name: it stays. Then Escape hides it.
      const box = (await name.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
        steps: 12,
      });
      await expect(name, label).toHaveCSS("opacity", "1");
      await page.keyboard.press("Escape");
      await expect(name, label).toHaveCSS("opacity", "0");
      await page.mouse.move(0, 0);
    }
  });
}
