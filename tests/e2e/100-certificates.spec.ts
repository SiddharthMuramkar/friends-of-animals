import { expect } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/server/db/schema";
import { directTls } from "../../src/server/db/database-url";
import { SEED_RESULTS } from "../../src/server/seed/results";
import { SEED_GUARDIANS } from "../../src/server/seed/guardians";
import { SEED_PARTICIPANTS } from "../../src/server/seed/participants";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { localSeedUrl, test } from "./support/seed-account";
import { signInByCode, expectNoSidewaysScrollAt320 } from "./support/sign-in";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
test("checks a certificate without scripts, then a guardian sees only their children and staff checks the issuance board", async ({
  page,
  browser,
  request,
  baseURL,
  seedAccount,
}) => {
  const url = localSeedUrl(baseURL);
  const sql = postgres(url, {
    ...directTls(url),
    max: 1,
    prepare: false,
    connect_timeout: 5,
  });
  const db = drizzle({ client: sql, schema });
  try {
    const [adult] = await db
      .select()
      .from(schema.certificate)
      .where(
        and(
          eq(
            schema.certificate.participantProfileId,
            SEED_PARTICIPANTS.confirmed.profileId
          ),
          eq(schema.certificate.competitionId, SEED_RESULTS.competitionId),
          eq(schema.certificate.type, "participation")
        )
      );
    const [child] = await db
      .select()
      .from(schema.certificate)
      .where(
        and(
          eq(
            schema.certificate.participantProfileId,
            SEED_GUARDIANS.children.young.profileId
          ),
          eq(schema.certificate.competitionId, SEED_RESULTS.competitionId),
          eq(schema.certificate.type, "participation")
        )
      );
    if (!adult || !child) throw Error("Missing seeded certificates");
    await page.goto("/verify");
    await expectAccessible(page, "verification form");
    await expectAccessibleInDark(page, "verification form");
    await expectNoSidewaysScrollAt320(page, "verification form");
    const noJs = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
    });
    try {
      const form = await noJs.newPage();
      await form.goto("/verify");
      await form
        .getByRole("textbox", { name: "Certificate number" })
        .fill(adult.number.toLowerCase());
      await form.getByRole("button", { name: "Check certificate" }).click();
      await expect(form).toHaveURL(new RegExp(`/verify/${adult.number}$`));
      await expect(
        form.getByRole("heading", { name: "Valid certificate" })
      ).toBeVisible();
    } finally {
      await noJs.close();
    }
    await page.goto(`/verify/${adult.number}`);
    await expect(
      page.getByRole("heading", { name: "Valid certificate" })
    ).toBeVisible();
    await expectAccessible(page, "valid certificate");
    await expectAccessibleInDark(page, "valid certificate");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/
    );
    await page.goto("/verify/FOA-C-27-0000000000");
    await expect(
      page.getByRole("heading", { name: "Unknown certificate" })
    ).toBeVisible();
    await expectAccessible(page, "unknown certificate");
    const blocked = await page.request.get(
      `/api/certificates/${adult.id}/pdf`,
      { maxRedirects: 0 }
    );
    expect(blocked.status()).toBe(403);
    await signInByCode(page, request, SEED_GUARDIANS.guardian.email);
    await page.goto("/dashboard/certificates");
    await expect(
      page.getByRole("heading", {
        name: SEED_GUARDIANS.children.young.fullName,
      })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: SEED_GUARDIANS.children.teen.fullName })
    ).toBeVisible();
    await expect(page.getByText(adult.number, { exact: true })).toHaveCount(0);
    await expectAccessible(page, "guardian certificates");
    await expectAccessibleInDark(page, "guardian certificates");
    const guardianDownload = await page.request.get(
      `/api/certificates/${child.id}/pdf`,
      { maxRedirects: 0 }
    );
    expect(guardianDownload.status()).toBe(
      child.renderStatus === "rendered" ? 302 : 409
    );
    if (child.renderStatus === "rendered") {
      expect(guardianDownload.headers()["cache-control"]).toContain("no-store");
      const pdf = await page.request.get(guardianDownload.headers().location!);
      expect(pdf.ok()).toBe(true);
      expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    }
    const unrelated = await page.request.get(
      `/api/certificates/${adult.id}/pdf`,
      { maxRedirects: 0 }
    );
    expect(unrelated.status()).toBe(403);
    const secret = generateTotpSecret();
    const staff = await seedAccount({
      name: "Certificate reviewer",
      grants: [
        {
          role: "competition_manager",
          scope: { type: "competition", id: SEED_RESULTS.competitionId },
        },
      ],
      totpSecret: secret,
    });
    const device = await browser.newContext({ baseURL });
    try {
      const admin = await device.newPage();
      await signInByCode(admin, request, staff);
      await admin.goto(
        `/admin/certificates?competition=${SEED_RESULTS.competitionId}`
      );
      await expect(admin).toHaveURL(/\/auth\/second-factor\?next=/);
      await admin
        .getByRole("textbox", { name: "6-digit code" })
        .fill(totpCode(secret, new Date()));
      await admin.getByRole("button", { name: "Continue" }).click();
      await expect(
        admin.getByRole("heading", { name: adult.number })
      ).toBeVisible();
      await expectAccessible(admin, "certificate issuance board");
      await expectAccessibleInDark(admin, "certificate issuance board");
    } finally {
      await device.close();
    }
  } finally {
    await sql.end();
  }
});
