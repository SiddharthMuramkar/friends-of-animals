// A real Postgres race: no duplicate physical custody record or acknowledgement.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  competitionAgeGroup,
  entry,
  participantProfile,
  physicalArtwork,
  registration,
} from "@/server/db/schema";
import { createPgWorld, type PgWorld } from "@/test/pg";
import {
  SEED_ARTWORK_COMPETITION,
  SEED_COMPETITION_MANAGER,
} from "@/server/seed/competitions";
import { SEED_ARTWORK_VERIFIER } from "@/server/seed/physical-artwork";
import { conditionPhotos, verificationDetails } from "./testing";
import { PROFILE_PURPOSE } from "../registration/student-profile";
import { generateCode } from "../codes/codes";

let world: PgWorld;
beforeAll(() => {
  world = createPgWorld();
});
afterAll(async () => {
  await world.close();
});

describe("physical artwork concurrency", () => {
  it("serializes duplicate requests and receipts", async () => {
    await world.seed.preview();
    const manager = world.as(
      await world.signedIn(SEED_COMPETITION_MANAGER, { secondFactor: true })
    );
    const member = await world.seed.member({ email: world.uniqueEmail() });
    const profileId = randomUUID(),
      registrationId = randomUUID(),
      entryId = randomUUID();
    const competitionId = SEED_ARTWORK_COMPETITION.id;
    const [group] = await world.db
      .select()
      .from(competitionAgeGroup)
      .where(eq(competitionAgeGroup.competitionId, competitionId));
    const now = world.clock.now();
    await world.db.insert(participantProfile).values({
      id: profileId,
      ownerKind: "self",
      ownerUserId: member.id,
      fullName: "Race participant",
      dobCiphertext: world.deps.cipher.encrypt(
        PROFILE_PURPOSE.dob,
        "1995-02-01"
      ),
      identityHash: randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    await world.db.insert(registration).values({
      id: registrationId,
      participantProfileId: profileId,
      competitionId,
      route: "individual",
      ageGroupId: group!.id,
      status: "confirmed",
      registrationNumber: generateCode({ prefix: "ORIG27-R-", length: 6 }),
      createdAt: now,
      updatedAt: now,
    });
    await world.db.insert(entry).values({
      id: entryId,
      code: generateCode({ prefix: "ORIG27-E-", length: 6 }),
      competitionId,
      registrationId,
      participantProfileId: profileId,
      discipline: "drawing",
      title: "Ready",
      description: "A ready artwork",
      status: "foa_verified",
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const input = { competitionId, entryIds: [entryId] };
    const requests = await Promise.all([
      manager.requestPhysicalArtwork(input),
      manager.requestPhysicalArtwork(input),
    ]);
    expect(requests.filter((r) => r.ok)).toHaveLength(1);
    expect(requests.filter((r) => !r.ok)).toMatchObject([
      { error: "already_requested" },
    ]);
    const result = requests.find((r) => r.ok);
    if (!result?.ok) throw new Error("missing artwork");
    const artworkId = result.artworks[0]!.artworkId;
    const receipts = await Promise.all([
      manager.markArtworkReceived({ artworkId }),
      manager.markArtworkReceived({ artworkId }),
    ]);
    expect(receipts.filter((r) => r.ok)).toHaveLength(1);
    expect(receipts.filter((r) => !r.ok)).toMatchObject([
      { error: "already_received" },
    ]);
    const verifierActor = await world.signedIn(SEED_ARTWORK_VERIFIER, {
      secondFactor: true,
    });
    const verifier = world.as(verifierActor);
    const photos = await conditionPhotos(world, verifierActor, artworkId);
    const decisions = await Promise.all([
      verifier.verifyArtwork({ artworkId, ...verificationDetails, photos }),
      verifier.raiseArtworkDiscrepancy({
        artworkId,
        reason: "mismatch",
        notes: "Label differs",
      }),
    ]);
    // Exactly one inspection can commit. The row lock forces the other
    // decision to observe its new status instead of overwriting it.
    expect(decisions.filter((d) => d.ok)).toHaveLength(1);
    expect(decisions.filter((d) => !d.ok)).toHaveLength(1);
    const custody = await verifier.getArtworkCustody({ artworkId });
    if (!custody.ok) throw new Error("missing custody");
    expect(["verified", "discrepancy"]).toContain(custody.status);
    expect(Boolean(custody.verification)).toBe(custody.status === "verified");
    expect(custody.discrepancies.length).toBe(
      custody.status === "discrepancy" ? 1 : 0
    );
    expect(
      await world.db
        .select()
        .from(physicalArtwork)
        .where(eq(physicalArtwork.entryId, entryId))
    ).toMatchObject([{ id: artworkId, status: custody.status }]);
  });
});
