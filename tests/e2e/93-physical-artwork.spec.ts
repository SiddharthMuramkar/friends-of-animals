import { randomInt, randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { fieldKeyEnvSchema, parseEnv } from "../../src/env.schema";
import { fieldCryptoFor } from "../../src/server/crypto/keys";
import { directTls } from "../../src/server/db/database-url";
import * as schema from "../../src/server/db/schema";
import { PROFILE_PURPOSE } from "../../src/server/modules/registration/student-profile";
import {
  generateTotpSecret,
  totpCode,
} from "../../src/server/modules/second-factor/domain/totp";
import { SEED_ARTWORK_COMPETITION } from "../../src/server/seed/competitions";
import { SEED_COORDINATORS } from "../../src/server/seed/coordinators";
import {
  expectAccessible,
  expectAccessibleInDark,
  expectRendersAccessibly,
} from "./support/a11y";
import { localSeedUrl, test } from "./support/seed-account";
import { newDevice, signInByCode } from "./support/sign-in";

const board = "/admin/artwork";
const symbols = () =>
  Array.from(
    { length: 6 },
    () => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[randomInt(32)]
  ).join("");

test("a competition manager requests verified work, its sender dispatches, and FOA records receipt", async ({
  page,
  request,
  browser,
  baseURL,
  seedAccount,
}, info) => {
  const comp = SEED_ARTWORK_COMPETITION;
  const secret = generateTotpSecret();
  const manager = await seedAccount({
    name: "Artwork manager",
    grants: [
      {
        role: "competition_manager",
        scope: { type: "competition", id: comp.id },
      },
    ],
    totpSecret: secret,
  });
  const owner = await seedAccount({
    name: "Artwork sender",
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
  const profileId = randomUUID(),
    registrationId = randomUUID(),
    entryId = randomUUID();
  const code = `${comp.code}-E-${symbols()}`;
  const now = new Date();
  try {
    const [account] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, owner));
    const [group] = await db
      .select({ id: schema.competitionAgeGroup.id })
      .from(schema.competitionAgeGroup)
      .where(eq(schema.competitionAgeGroup.competitionId, comp.id))
      .limit(1);
    if (!account || !group)
      throw new Error("Missing sample competition or actor");
    await db.transaction(async (tx) => {
      await tx.insert(schema.participantProfile).values({
        id: profileId,
        ownerKind: "self",
        ownerUserId: account.id,
        fullName: "Artwork sender",
        dobCiphertext: cipher.encrypt(PROFILE_PURPOSE.dob, "1995-02-01"),
        identityHash: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.registration).values({
        id: registrationId,
        participantProfileId: profileId,
        competitionId: comp.id,
        ageGroupId: group.id,
        route: "individual",
        status: "confirmed",
        registrationNumber: `${comp.code}-R-${symbols()}`,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.entry).values({
        id: entryId,
        code,
        competitionId: comp.id,
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
    });
    await signInByCode(page, request, manager);
    await page.goto(board);
    await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
    await page
      .getByRole("textbox", { name: "6-digit code" })
      .fill(totpCode(secret, new Date()));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/admin\/artwork$/);
    await expectAccessible(page, board);
    await expectAccessibleInDark(page, board);
    await page
      .getByRole("checkbox", { name: `${code} · A home for a bird` })
      .check();
    await page.getByRole("button", { name: "Request originals" }).click();
    await expect(page.getByText("Artwork updated.")).toBeVisible();
    const [requested] = await db
      .select()
      .from(schema.physicalArtwork)
      .where(eq(schema.physicalArtwork.entryId, entryId));
    expect(requested?.artworkCode).toMatch(/^ORIG27-A-/);
    const path = `${board}/${requested!.artworkCode}`;
    const sender = await newDevice(browser, info);
    try {
      await signInByCode(sender, request, owner);
      await expectRendersAccessibly(sender, "/dashboard/artwork");
      await expectAccessibleInDark(sender, "/dashboard/artwork");
      await sender.getByLabel("Courier name (Required)").fill("India Post");
      await sender.getByLabel("Tracking number (Required)").fill("AB 1234");
      await sender.getByRole("button", { name: "Record dispatch" }).click();
      await expect(sender.getByText("Artwork updated.")).toBeVisible();
      await expect(sender.getByText("AB1234")).toBeVisible();
    } finally {
      await sender.context().close();
    }
    await expectRendersAccessibly(page, path);
    await expectAccessibleInDark(page, path);
    await expect(page.getByText("AB1234")).toBeVisible();
    await page.getByRole("button", { name: "Mark received" }).click();
    await expect(page.getByText("Artwork updated.")).toBeVisible();
    await expect(page.getByText("Received", { exact: true })).toBeVisible();
    const coordinator = await newDevice(browser, info);
    try {
      await signInByCode(
        coordinator,
        request,
        SEED_COORDINATORS.coordinator.email
      );
      await expectRendersAccessibly(coordinator, "/institution/artwork");
      await expectAccessibleInDark(coordinator, "/institution/artwork");
    } finally {
      await coordinator.context().close();
    }
  } finally {
    await db.delete(schema.entry).where(eq(schema.entry.id, entryId));
    await db
      .delete(schema.registration)
      .where(eq(schema.registration.id, registrationId));
    await db
      .delete(schema.participantProfile)
      .where(eq(schema.participantProfile.id, profileId));
    await client.end();
  }
});
