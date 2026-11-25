import { expect } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/server/db/schema";
import { directTls } from "../../src/server/db/database-url";
import { SEED_RESULTS } from "../../src/server/seed/results";
import { SEED_GUARDIANS } from "../../src/server/seed/guardians";
import { SEED_PARTICIPANTS } from "../../src/server/seed/participants";
import { SEED_AUCTIONS } from "../../src/server/seed/auctions";
import { localSeedUrl, test } from "./support/seed-account";
import { signInByCode, expectNoSidewaysScrollAt320 } from "./support/sign-in";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";

test("a guardian can prepare and download only their own child's stamped certificate once media is rendered", async ({
  page,
  request,
  baseURL,
}, info) => {
  // The CI app has no media worker/Gotenberg; local proof starts a
  // disposable renderer and drains the actual media job. Do not infer the
  // expected state from the row we are testing.
  const realMedia = !!process.env.GOTENBERG_URL;
  const dbUrl = localSeedUrl(baseURL);
  const sql = postgres(dbUrl, {
    ...directTls(dbUrl),
    max: 1,
    prepare: false,
    connect_timeout: 5,
  });
  const db = drizzle({ client: sql, schema });
  try {
    const profile =
      info.project.name === "mobile"
        ? SEED_GUARDIANS.children.teen
        : SEED_GUARDIANS.children.young;
    const find = (profileId: string) =>
      db
        .select()
        .from(schema.certificate)
        .where(
          and(
            eq(schema.certificate.participantProfileId, profileId),
            eq(schema.certificate.competitionId, SEED_RESULTS.competitionId),
            eq(schema.certificate.type, "participation")
          )
        );
    const [child] = await find(profile.profileId);
    const [unrelated] = await find(SEED_PARTICIPANTS.confirmed.profileId);
    if (!child || !unrelated) throw Error("Missing seeded certificates");
    expect(child.renderStatus).toBe(realMedia ? "rendered" : "pending");
    const path = `/api/certificates/${child.id}/share`;
    expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(403);
    await signInByCode(page, request, SEED_GUARDIANS.guardian.email);
    await page.goto("/dashboard/certificates");
    await expect(
      page.getByRole("heading", { name: profile.fullName })
    ).toBeVisible();
    await expect(page.getByText(unrelated.number, { exact: true })).toHaveCount(
      0
    );
    await expectAccessible(page, "recipient certificates");
    await expectAccessibleInDark(page, "recipient certificates");
    await expectNoSidewaysScrollAt320(page, "recipient certificates");
    expect(
      (
        await page.request.get(`/api/certificates/${unrelated.id}/share`, {
          maxRedirects: 0,
        })
      ).status()
    ).toBe(403);
    expect((await page.request.get(path, { maxRedirects: 0 })).status()).toBe(
      409
    );
    const prepare = page.getByRole("button", {
      name: `Prepare share image ${child.number}`,
    });
    const download = page.getByRole("link", {
      name: `Download share image (PNG) ${child.number}`,
    });
    if (!realMedia) {
      await expect(prepare).toHaveCount(0);
      await expect(download).toHaveCount(0);
    } else {
      await expect(prepare).toBeVisible();
      await prepare.click();
      await expect(
        page.getByText("Your share image is being prepared.", { exact: false })
      ).toBeVisible();
      await expect
        .poll(async () => {
          await page.reload();
          return download.isVisible();
        })
        .toBe(true);
      await expectAccessible(page, "prepared share image");
      const signed = await page.request.get(path, { maxRedirects: 0 });
      expect(signed.status()).toBe(302);
      expect(signed.headers()["cache-control"]).toContain("no-store");
      const image = await page.request.get(signed.headers().location!);
      expect(image.ok()).toBe(true);
      expect(image.headers()["content-type"]).toBe("image/png");
      expect(image.headers()["content-disposition"]).toContain(
        child.number + ".png"
      );
      expect((await image.body()).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      );
    }
  } finally {
    await sql.end();
  }
});

test("only the stamped, no-store artwork is shown on a public lot", async ({
  page,
  request,
}) => {
  await page.goto(`/auctions/${SEED_AUCTIONS.open}`);
  const image = page.getByRole("img", {
    name: "Artwork with the Friends of Animals logo",
  });
  await expect(image).toBeVisible();
  const src = `/media/auctions/${SEED_AUCTIONS.open}`;
  await expect(image).toHaveAttribute("src", src);
  const response = await request.get(src);
  expect(response.ok()).toBe(true);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["content-type"]).toBe("image/webp");
  expect((await response.body()).subarray(8, 12).toString()).toBe("WEBP");
  expect(
    (await request.get(`/media/auctions/${SEED_AUCTIONS.cancelled}`)).status()
  ).toBe(404);
  await expectAccessible(page, "stamped auction artwork");
  await expectAccessibleInDark(page, "stamped auction artwork");
});
