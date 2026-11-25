// Local and preview-only sample original works. Separate competition and
// artwork rows keep the custody and judging journeys independent.
import { and, eq } from "drizzle-orm";
import {
  auctionLot,
  artworkCustodyEvent,
  artworkVerification,
  competition,
  competitionAgeGroup,
  competitionConsentDocument,
  consentDocument,
  consentEvent,
  entry,
  participantProfile,
  physicalArtwork,
  registration,
} from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { ensureGrant } from "./access";
import { ensureSeedAuthenticator } from "./second-factor";
import { competitionBuilder } from "./competitions";
import { SEED_GUARDIANS } from "./guardians";
import { SEED_PARTICIPANTS } from "./participants";
import type { Seeder } from "./types";

const id = (n: number) =>
  `01938a00-0000-7000-8000-000000131${String(n).padStart(3, "0")}`;
const lotCode = (n: number) => `LOT-27-5EED${n}`;
export const SEED_AUCTIONS = {
  manager: {
    id: id(100),
    email: "auction-manager@example.test",
    name: "Sample Auction Manager",
  },
  competitionCode: "AUCT27",
  open: lotCode(1),
  scheduled: lotCode(2),
  unsold: lotCode(3),
  cancelled: lotCode(4),
  eligibleArtworkCode: "AUCT27-A-5EED03",
} as const;

export const seedAuctions: Seeder = async (deps) => {
  const { db, clock } = deps;
  const manager = await ensureVerifiedAccount(deps, SEED_AUCTIONS.manager);
  await ensureGrant(deps, manager.id, {
    role: "auction_manager",
    scope: { type: "global" },
  });
  await ensureSeedAuthenticator(deps, manager.id);
  const now = clock.now(),
    days = (n: number) => new Date(now.getTime() + n * 86400000);
  const [existing] = await db
    .select({ id: competition.id })
    .from(competition)
    .where(eq(competition.code, SEED_AUCTIONS.competitionCode));
  const comp =
    existing ??
    (await competitionBuilder(deps)({
      code: SEED_AUCTIONS.competitionCode,
      name: "Art for kindness",
      status: "school_judging",
      auctionPermitted: true,
      ageGroups: [
        { label: "6–12", minAge: 6, maxAge: 12 },
        { label: "13–17", minAge: 13, maxAge: 17 },
        { label: "Adults", minAge: 18, maxAge: 99 },
      ],
    }));
  const [doc] = await db
    .select({ id: consentDocument.id })
    .from(consentDocument)
    .where(
      and(
        eq(consentDocument.purpose, "auction"),
        eq(consentDocument.version, 1)
      )
    );
  if (!doc) return;
  await db
    .insert(competitionConsentDocument)
    .values({
      competitionId: comp.id,
      purpose: "auction",
      consentDocumentId: doc.id,
      attachedAt: now,
    })
    .onConflictDoNothing();
  const groups = await db
    .select()
    .from(competitionAgeGroup)
    .where(eq(competitionAgeGroup.competitionId, comp.id));
  const works = [
    {
      profileId: SEED_PARTICIPANTS.confirmed.profileId,
      age: 36,
      title: "A refuge for birds",
      story:
        "A celebration of kindness to the birds who share our neighbourhood.",
      status: "retained" as const,
    },
    {
      profileId: SEED_GUARDIANS.children.teen.profileId,
      age: 15,
      title: "A kinder street",
      story:
        "A drawing imagining a city where every street dog has a safe home.",
      status: "on_exhibition" as const,
    },
    {
      profileId: SEED_PARTICIPANTS.pending.profileId,
      age: 40,
      title: "The garden that grew",
      story: "A garden that welcomes every creature.",
      status: "verified" as const,
    },
    {
      profileId: SEED_GUARDIANS.children.young.profileId,
      age: 8,
      title: "Our friends",
      story: "A little painting of friends and animals.",
      status: "verified" as const,
    },
  ];
  for (const [index, work] of works.entries()) {
    const n = index + 1;
    const [profile] = await db
      .select()
      .from(participantProfile)
      .where(eq(participantProfile.id, work.profileId));
    const group = groups.find(
      (g) => g.minAge <= work.age && g.maxAge >= work.age
    );
    if (!profile || !group) continue;
    const regId = id(n),
      entryId = id(10 + n),
      artworkId = id(20 + n),
      consentId = id(30 + n);
    const guardian = work.age < 18;
    const giver = guardian ? SEED_GUARDIANS.guardian.id : profile.ownerUserId;
    if (!giver) continue;
    await db
      .insert(registration)
      .values({
        id: regId,
        participantProfileId: profile.id,
        competitionId: comp.id,
        route: "individual",
        ageGroupId: group.id,
        status: "confirmed",
        registrationNumber: `AUCT27-R-5EED0${n}`,
        createdAt: days(-100),
        updatedAt: days(-60),
      })
      .onConflictDoNothing();
    await db
      .insert(entry)
      .values({
        id: entryId,
        code: `AUCT27-E-5EED0${n}`,
        competitionId: comp.id,
        registrationId: regId,
        participantProfileId: profile.id,
        discipline: "drawing",
        title: work.title,
        description: work.story,
        status: "foa_verified",
        submittedAt: days(-60),
        createdAt: days(-60),
        updatedAt: days(-20),
      })
      .onConflictDoNothing();
    await db
      .insert(physicalArtwork)
      .values({
        id: artworkId,
        entryId,
        registrationId: regId,
        competitionId: comp.id,
        artworkCode: `AUCT27-A-5EED0${n}`,
        status: work.status,
        requestedAt: days(-50),
        dispatchDeadline: days(-30),
        packagingInstructions: "Protect the original artwork",
        shippingPayer: "sender",
        facilityAddress: "Sample FOA address",
        receivedAt: days(-25),
        storageLocation: "Sample archive shelf",
        retainedAt: work.status === "retained" ? days(-5) : null,
      })
      .onConflictDoNothing();
    await db
      .insert(artworkVerification)
      .values({
        artworkId,
        verifiedBy: manager.id,
        verifiedAt: days(-20),
        codeMatchesLabel: true,
        creatorConfirmed: true,
        matchesDigital: true,
        consentDocumentsOk: true,
        condition: "good",
        widthMm: 297,
        heightMm: 420,
        material: "Paper",
      })
      .onConflictDoNothing();
    await db
      .insert(consentEvent)
      .values({
        id: consentId,
        subjectType: guardian ? "participant_profile" : "user",
        subjectId: guardian ? profile.id : giver,
        giverUserId: giver,
        purpose: "auction",
        documentId: doc.id,
        competitionId: comp.id,
        action: "given",
        method: "web_form",
        occurredAt: days(-99),
      })
      .onConflictDoNothing();
    // Third and fourth originals are free for a manager to draft a lot.
    // Historical terminal lots use the third original, no active reservation.
    const statuses =
      n === 1
        ? ["open"]
        : n === 2
          ? ["scheduled"]
          : n === 3
            ? ["unsold", "cancelled"]
            : [];
    for (const status of statuses) {
      const k =
        status === "open"
          ? 1
          : status === "scheduled"
            ? 2
            : status === "unsold"
              ? 3
              : 4;
      const starts = status === "open" ? -1 : status === "scheduled" ? 2 : -30;
      const ends = status === "open" ? 7 : status === "scheduled" ? 9 : -20;
      const [inserted] = await db
        .insert(auctionLot)
        .values({
          id: id(40 + k),
          lotCode: lotCode(k),
          artworkId,
          consentEventId: consentId,
          artworkStatusBeforeListing: work.status,
          status: status as "open" | "scheduled" | "unsold" | "cancelled",
          story: work.story,
          basePricePaise: 100000n,
          reservePricePaise: 150000n,
          opensAt: days(starts),
          closesAt: days(ends),
          createdAt: days(-40),
          updatedAt: days(-1),
          createdBy: manager.id,
          cancellationReason:
            status === "cancelled" ? "Sample cancellation" : null,
        })
        .onConflictDoNothing()
        .returning({ id: auctionLot.id });
      if (inserted && (status === "open" || status === "scheduled")) {
        await db
          .insert(artworkCustodyEvent)
          .values({
            id: id(50 + k),
            artworkId,
            kind: "auction_reserved",
            location: "Sample archive shelf",
            actorUserId: manager.id,
            at: days(-2),
          })
          .onConflictDoNothing();
      }
    }
  }
};
