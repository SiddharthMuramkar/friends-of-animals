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
import { SEED_ENTRY_COMPETITIONS } from "../../src/server/seed/competitions";
import { expectAccessible, expectRendersAccessibly } from "./support/a11y";
import { localSeedUrl, test } from "./support/seed-account";
import { newDevice, signInByCode } from "./support/sign-in";

const QUEUE = "/admin/verification";
const symbols = () =>
  Array.from(
    { length: 6 },
    () => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[randomInt(32)]
  ).join("");

// Each test owns its participant and entry, so mobile and desktop may run together.
test("a verifier sends an entry back, the participant corrects it, and FOA verifies it", async ({
  page,
  request,
  browser,
  baseURL,
  seedAccount,
}, info) => {
  const secret = generateTotpSecret();
  const verifier = await seedAccount({
    name: "Digital verifier",
    grants: [{ role: "foa_verifier", scope: { type: "global" } }],
    totpSecret: secret,
  });
  const owner = await seedAccount({
    name: "Essay participant",
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
    entryId = randomUUID(),
    fileId = randomUUID();
  const competition = SEED_ENTRY_COMPETITIONS[1];
  const code = `${competition.code}-E-${symbols()}`;
  const path = `/participant/entries/${code}`;
  try {
    const [account] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, owner));
    const [ageGroup] = await db
      .select({ id: schema.competitionAgeGroup.id })
      .from(schema.competitionAgeGroup)
      .where(eq(schema.competitionAgeGroup.competitionId, competition.id))
      .limit(1);
    if (!account || !ageGroup)
      throw new Error("Missing seed account or competition");
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(schema.participantProfile).values({
        id: profileId,
        ownerKind: "self",
        ownerUserId: account.id,
        fullName: "Essay participant",
        dobCiphertext: cipher.encrypt(PROFILE_PURPOSE.dob, "1995-02-01"),
        identityHash: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.registration).values({
        id: registrationId,
        participantProfileId: profileId,
        competitionId: competition.id,
        ageGroupId: ageGroup.id,
        route: "individual",
        status: "confirmed",
        registrationNumber: `${competition.code}-R-${symbols()}`,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.entry).values({
        id: entryId,
        code,
        competitionId: competition.id,
        registrationId,
        participantProfileId: profileId,
        discipline: "essay",
        title: "A bird in the garden",
        description: "How a bird found shelter",
        status: "submitted_to_foa",
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.entryFile).values({
        id: fileId,
        entryId,
        attemptNumber: 1,
        kind: "text",
        status: "live",
        essayBody: { paragraphs: [["Birds need shade and fresh water."]] },
        wordCount: 6,
        uploadCompletedAt: now,
        becameLiveAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.entryTransition).values([
        {
          id: randomUUID(),
          entryId,
          sequence: 1,
          toStatus: "submitted",
          trigger: "essay_typed",
          actorKind: "system",
          at: now,
        },
        {
          id: randomUUID(),
          entryId,
          sequence: 2,
          fromStatus: "submitted",
          toStatus: "submitted_to_foa",
          trigger: "forwarded_to_foa",
          actorKind: "system",
          at: now,
        },
      ]);
    });
    await signInByCode(page, request, verifier);
    await page.goto(QUEUE);
    await expect(page).toHaveURL(/\/auth\/second-factor\?next=/);
    await page
      .getByRole("textbox", { name: "6-digit code" })
      .fill(totpCode(secret, new Date()));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/admin\/verification$/);
    await expectAccessible(page, "verification queue");
    await page.getByRole("link", { name: `Review entry ${code}` }).click();
    await expect(
      page.getByText("Birds need shade and fresh water.")
    ).toBeVisible();
    await expectAccessible(page, "verification detail");
    await page.getByRole("radio", { name: "Other" }).check();
    await page
      .getByLabel("Additional correction instructions (required for Other)")
      .fill("Please clarify the title.");
    await page
      .getByRole("button", { name: "Send back for correction" })
      .click();
    await expect(
      page.getByText("The entry decision was recorded.")
    ).toBeVisible();
    const participant = await newDevice(browser, info);
    try {
      await signInByCode(participant, request, owner);
      await expectRendersAccessibly(participant, path);
      await expect(
        participant.getByText("Please clarify the title.")
      ).toBeVisible();
      await participant
        .getByRole("form", { name: "Resubmit corrected details" })
        .getByLabel("Title", { exact: true })
        .fill("A bird finds shelter");
      await participant
        .getByRole("button", { name: "Resubmit corrected details" })
        .click();
      await expect(
        participant.getByRole("heading", { name: "A bird finds shelter" })
      ).toBeVisible();
      await expect(
        participant.getByText("Correction requested by FOA")
      ).toHaveCount(0);
    } finally {
      await participant.context().close();
    }
    await page.goto(QUEUE);
    await page.getByRole("link", { name: `Review entry ${code}` }).click();
    await expect(
      page.getByRole("heading", { name: "A bird finds shelter" })
    ).toBeVisible();
    await page.getByRole("button", { name: "Mark verified" }).click();
    await expect(
      page.getByText("The entry decision was recorded.")
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: `Review entry ${code}` })
    ).toHaveCount(0);
  } finally {
    await db.delete(schema.entry).where(eq(schema.entry.id, entryId));
    await db
      .delete(schema.registration)
      .where(eq(schema.registration.id, registrationId));
    await db
      .delete(schema.participantProfile)
      .where(eq(schema.participantProfile.id, profileId));
    await client.end({ timeout: 5 });
  }
});
