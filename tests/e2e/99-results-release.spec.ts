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
import { drainOutbox } from "./support/mailbox";

const code = () =>
  `RES${Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("")}27`;
const istSeconds = (at: Date) =>
  new Date(at.getTime() + 19800000).toISOString().slice(0, 19);

test("two staff release approved results, and visitors see only consented recognition", async ({
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
  const name = `Results journey ${randomUUID().slice(0, 8)}`;
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
        await signInByCode(screen, request, email);
        await screen.goto(path);
        await expect(screen).toHaveURL(/\/auth\/second-factor\?next=/);
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
      await expectAccessibleInDark(page, "prepare results");
      // The ordinarily cached competition detail always links to the live
      // results page during judging; no credit from the private lock leaks.
      await page.goto(`/competitions/${c.slug}`);
      await page.getByRole("link", { name: "Results", exact: true }).click();
      await expect(
        page.getByText("Results have not been published yet.")
      ).toBeVisible();
      await expect(page.getByText("Asha Rao", { exact: true })).toHaveCount(0);
      await expectAccessible(page, "waiting for results");
      await expectAccessibleInDark(page, "waiting for results");
      await page.goto(path);

      await page
        .getByLabel("Locked final round (Required)")
        .selectOption(roundId);
      await page
        .getByLabel("Prize delivery instructions (Required)")
        .fill("FOA will contact the family to arrange trophy collection.");
      const publishAt = new Date(Date.now() + 15_000);
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
    } finally {
      await approvalPage.context().close();
    }
  } finally {
    await client.end();
  }
});
