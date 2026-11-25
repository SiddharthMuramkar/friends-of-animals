import { randomInt, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { fieldKeyEnvSchema, parseEnv } from "../../src/env.schema";
import { fieldCryptoFor } from "../../src/server/crypto/keys";
import { directTls } from "../../src/server/db/database-url";
import * as schema from "../../src/server/db/schema";
import { PROFILE_PURPOSE } from "../../src/server/modules/registration/student-profile";
import { expect } from "@playwright/test";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_ARTWORK_COMPETITION } from "../../src/server/seed/competitions";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { drainOutbox } from "./support/mailbox";
import { localSeedUrl, test } from "./support/seed-account";
import { newDevice, signInByCode } from "./support/sign-in";

const board = "/admin/artwork";
const symbols = () =>
  Array.from(
    { length: 6 },
    () => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[randomInt(32)]
  ).join("");
const samplePhoto = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX7cAAAAASUVORK5CYII=",
  "base64"
);

test("FOA resolves a discrepancy, verifies with private condition photos and records custody; the creator requests return", async ({
  page,
  request,
  browser,
  baseURL,
  seedAccount,
}, info) => {
  const secret = generateTotpSecret();
  const verifier = await seedAccount({
    name: "Artwork verifier",
    grants: [{ role: "foa_verifier", scope: { type: "global" } }],
    totpSecret: secret,
  });
  const owner = await seedAccount({
    name: "Artwork creator",
    grants: [{ role: "participant", scope: { type: "global" } }],
  });
  const url = localSeedUrl(baseURL);
  const client = postgres(url, {
    ...directTls(url),
    max: 1,
    prepare: false,
    connect_timeout: 5,
  });
  const db = drizzle({ client, schema });
  const { cipher } = fieldCryptoFor(parseEnv(fieldKeyEnvSchema, process.env));
  const now = new Date();
  const competitionId = SEED_ARTWORK_COMPETITION.id;
  const profileId = randomUUID(),
    registrationId = randomUUID(),
    entryId = randomUUID(),
    artworkId = randomUUID();
  const artworkCode = `ORIG27-A-${symbols()}`;
  const path = `${board}/${artworkCode}`;
  try {
    const [account] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, owner));
    const [group] = await db
      .select({ id: schema.competitionAgeGroup.id })
      .from(schema.competitionAgeGroup)
      .where(eq(schema.competitionAgeGroup.competitionId, competitionId))
      .limit(1);
    if (!account || !group)
      throw new Error("Missing test account or age group");
    await db.transaction(async (tx) => {
      await tx.insert(schema.participantProfile).values({
        id: profileId,
        ownerKind: "self",
        ownerUserId: account.id,
        fullName: "Artwork creator",
        dobCiphertext: cipher.encrypt(PROFILE_PURPOSE.dob, "1995-02-01"),
        identityHash: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.registration).values({
        id: registrationId,
        participantProfileId: profileId,
        competitionId,
        ageGroupId: group.id,
        route: "individual",
        status: "confirmed",
        registrationNumber: `ORIG27-R-${symbols()}`,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.entry).values({
        id: entryId,
        code: `ORIG27-E-${symbols()}`,
        competitionId,
        registrationId,
        participantProfileId: profileId,
        discipline: "drawing",
        title: "A home for a bird",
        description: "A drawing of a bird shelter",
        status: "foa_verified",
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.physicalArtwork).values({
        id: artworkId,
        entryId,
        registrationId,
        competitionId,
        artworkCode,
        status: "received",
        requestedAt: now,
        dispatchDeadline: new Date(now.getTime() + 86400000),
        packagingInstructions: "Protect the artwork",
        shippingPayer: "sender",
        facilityAddress: "Sample FOA address",
        receivedAt: now,
      });
      await tx
        .insert(schema.artworkCustodyEvent)
        .values({ id: randomUUID(), artworkId, kind: "received", at: now });
    });
    await signInByCode(page, request, verifier);
    const discrepancies = `${board}/discrepancies`;
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
    await page
      .getByRole("textbox", { name: "6-digit code" })
      .fill(totpCode(secret, new Date()));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await page
      .getByRole("radio", { name: "Does not match digital entry" })
      .check();
    await page
      .getByLabel("Discrepancy notes (Required)")
      .fill("The label and digital entry differ.");
    await page.getByRole("button", { name: "Raise discrepancy" }).click();
    await expect(page.getByText("Artwork updated.")).toBeVisible();
    await page.goto(discrepancies);
    await expectAccessible(page, discrepancies);
    await expectAccessibleInDark(page, discrepancies);
    await page.getByRole("link", { name: artworkCode }).click();
    await expect(
      page.getByRole("heading", { name: "Discrepancy queue" })
    ).toBeVisible();
    await page
      .getByLabel("Resolution (Required)")
      .fill("Matched the corrected Artwork ID to the digital submission.");
    await page.getByRole("button", { name: "Resolve discrepancy" }).click();
    await expect(page.getByText("Artwork updated.")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Verify artwork" })
    ).toBeVisible();

    await expectRendersAccessibly(page, path);
    await page.getByRole("link", { name: "Verify artwork" }).click();
    await expect(
      page.getByRole("heading", { name: "Verify original artwork", level: 1 })
    ).toBeVisible();
    await expectAccessible(page, "verification");
    await expectAccessibleInDark(page, "verification");
    for (const kind of ["Front", "Back"]) {
      await page.getByRole("radio", { name: kind, exact: true }).check();
      await page.getByLabel("Condition photo (Required)").setInputFiles({
        name: `${kind}.png`,
        mimeType: "image/png",
        buffer: samplePhoto,
      });
      await page
        .getByRole("button", { name: "Upload condition photo" })
        .click();
      await expect(
        page.getByText(
          "Photo uploaded. Check the scan status before selecting it."
        )
      ).toBeVisible();
      await drainOutbox(request);
      await page.reload();
      await expect(
        page.getByRole("checkbox", {
          name: new RegExp(`Select ${kind} photo.*Clean`),
        })
      ).toBeChecked();
    }
    for (const name of [
      "Artwork ID matches the parcel label",
      "Creator matches the entry",
      "Original matches the digital submission",
      "Consent documents checked",
    ]) {
      await page.getByRole("checkbox", { name }).check();
    }
    await page.getByRole("radio", { name: "Good", exact: true }).check();
    await page.getByLabel("Width in mm (Required)").fill("297");
    await page.getByLabel("Height in mm (Required)").fill("420");
    await page.getByLabel("Material (Required)").fill("Watercolour on paper");
    await page
      .getByLabel("Storage or exhibition location (Required)")
      .fill("Store 1 / Rack B");
    await page
      .getByRole("button", { name: "Verify artwork", exact: true })
      .click();
    await expect(page.getByText("Artwork updated.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Verification record" })
    ).toBeVisible();
    const photo = page.getByRole("link", {
      name: "Open Front condition photo (1)",
    });
    await expect(photo).toBeVisible();
    const href = await photo.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).not.toContain(artworkCode);
    await expectAccessible(page, "verified artwork");
    await expectAccessibleInDark(page, "verified artwork");
    await page
      .getByLabel(
        "Put on exhibition · Storage or exhibition location (Required)"
      )
      .fill("Exhibition hall");
    await page
      .getByRole("button", { name: "Put on exhibition", exact: true })
      .click();
    await expect(
      page.getByText("Current storage location: Exhibition hall")
    ).toBeVisible();

    const sender = await newDevice(browser, info);
    try {
      await signInByCode(sender, request, owner);
      await expectRendersAccessibly(sender, "/dashboard/artwork");
      await expectAccessibleInDark(sender, "/dashboard/artwork");
      const card = sender.getByRole("listitem").filter({
        has: sender.getByRole("heading", { name: artworkCode }),
      });
      await card.getByRole("button", { name: "Ask for it back" }).click();
      await expect(
        card.getByText("Return requested", { exact: true })
      ).toBeVisible();
      await expect(
        card.getByRole("link", { name: /condition photo/ })
      ).toHaveCount(0);
    } finally {
      await sender.context().close();
    }
  } finally {
    const fileIds = (
      await db
        .select({ id: schema.artworkPhoto.fileAssetId })
        .from(schema.artworkPhoto)
        .where(eq(schema.artworkPhoto.artworkId, artworkId))
    ).map((row) => row.id);
    await db.delete(schema.entry).where(eq(schema.entry.id, entryId));
    if (fileIds.length)
      await db
        .delete(schema.fileAsset)
        .where(inArray(schema.fileAsset.id, fileIds));
    await db
      .delete(schema.registration)
      .where(eq(schema.registration.id, registrationId));
    await db
      .delete(schema.participantProfile)
      .where(eq(schema.participantProfile.id, profileId));
    await client.end();
  }
});
