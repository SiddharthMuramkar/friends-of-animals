import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { expect } from "@playwright/test";
import * as schema from "../../src/server/db/schema";
import { directTls } from "../../src/server/db/database-url";
import { competitionBuilder } from "../../src/server/seed/competitions";
import { systemClock } from "../../src/server/ports/clock";
import { SEED_PARTICIPANTS } from "../../src/server/seed/participants";
import { TIE_BREAK_RULE } from "../../src/server/modules/judging/domain/ranking";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { localSeedUrl, test } from "./support/seed-account";
import { newDevice, signInByCode } from "./support/sign-in";
import { expectAccessible, expectAccessibleInDark } from "./support/a11y";
import { drainOutbox, readCode } from "./support/mailbox";
import { SEED_CERTIFICATE_SCHOOL } from "../../src/server/seed/certificate-school";
import { readZip } from "../../src/server/modules/privacy/requests/subject-data/read-zip";
import { institutionRegistrationPath } from "../../src/lib/app-routes";

const code = () =>
  `CER${Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("")}27`;
const istSeconds = (at: Date) =>
  new Date(at.getTime() + 19800000).toISOString().slice(0, 19);

test("publish an approved release, verify its certificate publicly, revoke and see the old number revoked", async ({
  page,
  browser,
  request,
  baseURL,
  seedAccount,
}, info) => {
  const url = localSeedUrl(baseURL);
  const client = postgres(url, {
    ...directTls(url),
    max: 1,
    prepare: false,
    connect_timeout: 5,
  });
  const db = drizzle({ client, schema });
  const make = competitionBuilder({ db, clock: systemClock });
  const name = `Certificate journey ${randomUUID().slice(0, 8)}`;
  const c = await make({
    name,
    code: code(),
    status: "foa_judging",
    disciplines: ["drawing"],
    publicDisplay: true,
    physicalArtwork: { kind: "not_required" },
    participation: "individuals",
  });
  const path = `/admin/competitions/${c.id}/results`;
  const publicPath = `/competitions/${c.slug}/results`;
  const roundId = randomUUID(),
    entryId = randomUUID(),
    registrationId = randomUUID();
  const now = systemClock.now();
  try {
    const [group] = await db
      .select()
      .from(schema.competitionAgeGroup)
      .where(
        and(
          eq(schema.competitionAgeGroup.competitionId, c.id),
          eq(schema.competitionAgeGroup.label, "Adults")
        )
      );
    const [profile] = await db
      .select()
      .from(schema.participantProfile)
      .where(
        eq(schema.participantProfile.id, SEED_PARTICIPANTS.confirmed.profileId)
      );
    const [doc] = await db
      .select()
      .from(schema.consentDocument)
      .where(
        and(
          eq(schema.consentDocument.purpose, "public_display"),
          eq(schema.consentDocument.version, 1)
        )
      );
    if (!group || !profile?.ownerUserId || !doc)
      throw Error("Missing results fixture facts");
    await db.transaction(async (tx) => {
      await tx.insert(schema.registration).values({
        id: registrationId,
        participantProfileId: profile.id,
        competitionId: c.id,
        ageGroupId: group.id,
        route: "individual",
        status: "confirmed",
        registrationNumber: `${c.code}-R-5EED01`,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.entry).values({
        id: entryId,
        code: `${c.code}-E-5EED01`,
        competitionId: c.id,
        registrationId,
        participantProfileId: profile.id,
        discipline: "drawing",
        title: "Private artwork title",
        description: "Private work",
        status: "foa_verified",
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.competitionConsentDocument).values({
        competitionId: c.id,
        purpose: "public_display",
        consentDocumentId: doc.id,
        attachedAt: now,
      });
      await tx.insert(schema.consentEvent).values({
        id: randomUUID(),
        subjectType: "user",
        subjectId: profile.ownerUserId!,
        giverUserId: profile.ownerUserId!,
        competitionId: c.id,
        purpose: "public_display",
        documentId: doc.id,
        method: "web_form",
        action: "given",
        occurredAt: now,
      });
      await tx.insert(schema.judgingRound).values({
        id: roundId,
        competitionId: c.id,
        name: "National final",
        nameKey: "national final",
        status: "open",
        judgesPhysical: false,
        createdAt: now,
        updatedAt: now,
        openedAt: now,
      });
      await tx
        .insert(schema.roundEntry)
        .values({ roundId, entryId, admittedAt: now });
      await tx.insert(schema.roundResult).values({
        roundId,
        entryId,
        code: `${c.code}-E-5EED01`,
        discipline: "drawing",
        categoryId: group.id,
        rank: 1,
        scoreNumerator: "90",
        scoreDenominator: "1",
        sheetsCounted: 1,
        outcome: "winner",
        awardPosition: 1,
        suitableForAuction: false,
      });
      await tx
        .update(schema.judgingRound)
        .set({ status: "locked", lockedAt: now, tieBreakRule: TIE_BREAK_RULE })
        .where(eq(schema.judgingRound.id, roundId));
    });
    const preparerSecret = generateTotpSecret();
    const reviewerSecret = generateTotpSecret();
    const grants = [
      { role: "competition_manager", scope: { type: "competition", id: c.id } },
    ] as const;
    const preparer = await seedAccount({
      name: "Results preparer",
      grants: [...grants],
      totpSecret: preparerSecret,
    });
    const reviewer = await seedAccount({
      name: "Results reviewer",
      grants: [...grants],
      totpSecret: reviewerSecret,
    });
    const approvalPage = await newDevice(browser, info);
    try {
      for (const [screen, email, secret] of [
        [page, preparer, preparerSecret],
        [approvalPage, reviewer, reviewerSecret],
      ] as const) {
        await screen.goto("/sign-in");
        await expectAccessible(screen, "staff sign-in");
        await screen
          .getByRole("textbox", { name: "Email address" })
          .fill(email);
        await screen.getByRole("button", { name: "Email me a code" }).click();
        await expect(screen.getByRole("status")).toContainText(email);
        await expectAccessible(screen, "staff email code");
        await screen
          .getByRole("textbox", { name: "6-digit code" })
          .fill(await readCode(request, email));
        await screen.getByRole("button", { name: "Sign in" }).click();
        await expect(screen).toHaveURL(/\/account\/sessions$/);
        await expectAccessible(screen, "staff account sessions");
        await screen.goto(path);
        await expect(screen).toHaveURL(/\/auth\/second-factor\?next=/);
        await expectAccessible(screen, "staff second factor");
        await screen
          .getByRole("textbox", { name: "6-digit code" })
          .fill(totpCode(secret, new Date()));
        await screen.getByRole("button", { name: "Continue" }).click();
        await expect(screen).toHaveURL(new RegExp(`${path}$`));
      }
      await expect(
        page.getByRole("heading", { name: "Results release" })
      ).toBeVisible();
      await expectAccessible(page, "prepare results");

      await page
        .getByLabel("Locked final round (Required)")
        .selectOption(roundId);
      await page
        .getByLabel("Prize delivery instructions (Required)")
        .fill("FOA will contact the family to arrange trophy collection.");
      const publishAt = new Date(Date.now() + 10_000);
      await page
        .getByLabel("Publication date and time, IST (Required)")
        .fill(istSeconds(publishAt));
      await page.getByRole("button", { name: "Prepare for approval" }).click();
      await expect(
        page.getByText("Results prepared for independent approval.")
      ).toBeVisible();
      await expect(
        page.getByText(
          "A different authorised staff member must approve these results."
        )
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Approve results for publication" })
      ).toHaveCount(0);
      await approvalPage.reload();
      await expect(
        approvalPage.getByRole("heading", { name: "Awaiting approval" })
      ).toBeVisible();
      await expectAccessible(approvalPage, "awaiting independent approval");
      await expect(
        approvalPage.getByText(`${c.code}-E-5EED01 · Adults`)
      ).toBeVisible();
      await approvalPage
        .getByRole("button", { name: "Approve results for publication" })
        .click();
      await expect(
        approvalPage.getByText("Results approved and scheduled.")
      ).toBeVisible();
      await expectAccessible(approvalPage, "approved release");
      await expectAccessibleInDark(approvalPage, "approved release");
      await expect
        .poll(
          async () => {
            await drainOutbox(request);
            const [row] = await db
              .select({ status: schema.resultRelease.status })
              .from(schema.resultRelease)
              .where(eq(schema.resultRelease.competitionId, c.id));
            return row?.status;
          },
          { timeout: 20_000 }
        )
        .toBe("published");
      await page.goto(publicPath);
      await expect(
        page.getByRole("heading", { name: `Results: ${name}` })
      ).toBeVisible();
      await expect(page.getByText("Asha Rao", { exact: true })).toBeVisible();
      await expect(page.getByText("Private artwork title")).toHaveCount(0);
      await expect(page.getByText(`${c.code}-E-5EED01`)).toHaveCount(0);
      await expectAccessible(page, "public results");
      await expectAccessibleInDark(page, "public results");
      // The trusted publication delivery has now issued the certificate.
      // The PDF carries this exact /verify/<number> QR target; validity
      // is immediate independently of the media worker's PDF readiness.
      let issued: typeof schema.certificate.$inferSelect | undefined;
      await expect
        .poll(async () => {
          await drainOutbox(request);
          [issued] = await db
            .select()
            .from(schema.certificate)
            .where(
              and(
                eq(schema.certificate.registrationId, registrationId),
                eq(schema.certificate.type, "participation")
              )
            );
          return Boolean(issued);
        })
        .toBe(true);
      if (!issued) throw Error("Publication did not issue a certificate");
      const visitor = await newDevice(browser, info);
      try {
        await visitor.goto(`/verify/${issued.number}`);
        await expect(
          visitor.getByRole("heading", { name: "Valid certificate" })
        ).toBeVisible();
        await expectAccessible(visitor, "valid QR certificate");
        await expectAccessibleInDark(visitor, "valid QR certificate");
        await page.goto(`/admin/certificates?competition=${c.id}`);
        await expectAccessible(page, "certificate manager board");
        const card = page
          .getByRole("listitem")
          .filter({ has: page.getByRole("heading", { name: issued.number }) });
        await card.getByText("Revoke or reissue", { exact: false }).click();
        const revoke = card.getByRole("form", { name: "Revoke certificate" });
        await revoke
          .getByRole("textbox", { name: "Reason (Required)" })
          .fill("Issued in error");
        await expectAccessible(page, "certificate correction controls");
        await expectAccessibleInDark(page, "certificate correction controls");
        await revoke
          .getByRole("button", { name: "Revoke certificate" })
          .click();
        await expect(
          page.getByText("Certificate revoked. Its number is no longer valid.")
        ).toBeVisible();
        await expectAccessible(page, "revoked certificate manager board");
        await visitor.reload();
        await expect(
          visitor.getByRole("heading", { name: "Revoked certificate" })
        ).toBeVisible();
        await expect(
          visitor.getByText("This certificate is no longer valid.")
        ).toBeVisible();
        await expectAccessible(visitor, "revoked QR certificate");
        await expectAccessibleInDark(visitor, "revoked QR certificate");
      } finally {
        await visitor.context().close();
      }
    } finally {
      await approvalPage.context().close();
    }
  } finally {
    await client.end();
  }
});

// The coordinator's archive board is reachable from the school dashboard.
// PDF rendering runs on worker-media, not the web preview drain endpoint.
test("a school coordinator sees their pupils’ participation certificates on the archive board", async ({
  page,
  request,
  seedAccount,
}) => {
  const email = await seedAccount({
    name: "Certificate archive coordinator",
    grants: [
      {
        role: "institution_coordinator",
        scope: {
          type: "institution",
          id: SEED_CERTIFICATE_SCHOOL.institutionId,
        },
      },
    ],
  });
  await signInByCode(page, request, email);
  await expectAccessible(page, "coordinator account sessions");
  await page.goto(
    institutionRegistrationPath(
      SEED_CERTIFICATE_SCHOOL.reference,
      SEED_CERTIFICATE_SCHOOL.institutionId
    )
  );
  const panel = page.getByRole("region", { name: "Student certificates" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/of 2 valid certificates/);
  await expectAccessible(page, "student certificate archive board");
  await expectAccessibleInDark(page, "student certificate archive board");
  // As in #100, ordinary CI has no renderer. In a preview or a local run
  // with the real media worker, exercise the complete signed ZIP download.
  // Both states have explicit assertions; the use-case tests always drain
  // the jobs and inspect the complete ZIP with provider fakes.
  const ready = panel.getByText("2 of 2 valid certificates have a ready PDF.");
  if (await ready.isVisible()) {
    const prepare = panel.getByRole("button", {
      name: "Prepare certificate ZIP",
    });
    if (await prepare.isVisible()) {
      await prepare.click();
      await expect(panel).toContainText(/ZIP requested|ZIP is ready/);
    }
    const download = panel.getByRole("link", {
      name: "Download certificate ZIP",
    });
    await expect
      .poll(
        async () => {
          await page.reload();
          return download.isVisible();
        },
        { timeout: 15_000 }
      )
      .toBe(true);
    await expectAccessible(page, "downloadable student ZIP");
    await expectAccessibleInDark(page, "downloadable student ZIP");
    const href = await download.getAttribute("href");
    const redirect = await page.request.get(href!, { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    expect(redirect.headers()["cache-control"]).toContain("no-store");
    const zip = await page.request.get(redirect.headers().location!);
    expect(zip.ok()).toBe(true);
    expect(zip.headers()["content-type"]).toContain("application/zip");
    const names = readZip(new Uint8Array(await zip.body())).names;
    expect(names).toHaveLength(2);
    expect(
      names.every((name) =>
        /^FOA-C-\d{2}-[0-9A-HJKMNP-TV-Z]{10}\.pdf$/.test(name)
      )
    ).toBe(true);
  } else {
    await expect(
      panel.getByText(
        "All issued certificate PDFs must be ready before the ZIP can be prepared."
      )
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Prepare certificate ZIP" })
    ).toHaveCount(0);
  }
});
