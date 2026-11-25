// Local and preview-only sample original works. Separate competition and
// artwork rows keep the custody and judging journeys independent.
import { and, eq } from "drizzle-orm";
import {
  auctionLot,
  auctionBid,
  auctionOffer,
  paymentBatch,
  artworkCustodyEvent,
  artworkVerification,
  competition,
  competitionAgeGroup,
  competitionConsentDocument,
  consentDocument,
  consentEvent,
  entry,
  entryFile,
  fileAsset,
  participantProfile,
  physicalArtwork,
  registration,
} from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { ensureGrant } from "./access";
import { ensureSeedAuthenticator } from "./second-factor";
import { SEED_AUCTION_COMPETITION } from "./competitions";
import { emit } from "../outbox/emit";
import { SEED_ACCOUNTS } from "./accounts";
import { BID_DECLARATION_VERSION } from "../modules/auctions/domain/bid-declaration";
import { SEED_GUARDIANS } from "./guardians";
import { SEED_PARTICIPANTS } from "./participants";
import { postToLedger } from "../modules/ledger/post";
import { auctionCaptureLines } from "../modules/auctions/domain/proceeds";
import { PROFILE_PURPOSE } from "../modules/registration/student-profile";
import { IDENTITY_HASH_PURPOSE } from "../modules/registration/domain/prepare-student";
import { currentLotConsent } from "../modules/auctions/lifecycle";
import type { SeedDeps, Seeder } from "./types";
import { seedEntryDerivatives } from "./entries";
import { seedFilesLocation } from "./files";
import { storageFor } from "../ports/storage-for";
import { storageKeyFor } from "../modules/files/domain/storage-key";
import { queueStamp, renderStamp } from "../modules/stamping";
import { stampProcessor } from "../ports/media-stamp";
import { unconfiguredMedia } from "../ports/media";

async function seedLocalAuctionImage(
  deps: SeedDeps,
  input: {
    entryId: string;
    assetId: string;
    entryFileId: string;
    ownerId: string;
  }
) {
  // No actual participant work in the demonstration; the same labeled
  // illustration used by seed entries. Local seed scripts alone have a
  // real disk store and image processor; a preview can drain its worker.
  if (process.env.APP_ENV !== "local" || !process.env.APP_URL || !deps.storage)
    return;
  const storage = storageFor({
    APP_ENV: "local",
    APP_URL: process.env.APP_URL,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  });
  const { db, clock } = deps;
  const { bucket, keyPrefix: prefix } = seedFilesLocation();
  const now = clock.now();
  const queued = await db.transaction(async (tx) => {
    const [other] = await tx
      .select({ id: entryFile.id })
      .from(entryFile)
      .where(eq(entryFile.entryId, input.entryId))
      .limit(1);
    // Never overwrite a real upload or replacement in a reused seed DB.
    if (other && other.id !== input.entryFileId) return false;
    await tx
      .insert(fileAsset)
      .values({
        id: input.assetId,
        ownerUserId: input.ownerId,
        purpose: "entry_image",
        contentType: "image/webp",
        sizeBytes: 112200,
        bucket,
        storageKey: storageKeyFor({
          prefix,
          purpose: "entry_image",
          fileId: input.assetId,
        }),
        status: "clean",
        scanResult: "generated_sample_illustration",
        uploadedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    await tx
      .insert(entryFile)
      .values({
        id: input.entryFileId,
        entryId: input.entryId,
        fileAssetId: input.assetId,
        attemptNumber: 1,
        kind: "image",
        status: "live",
        uploadCompletedAt: now,
        becameLiveAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    const [live] = await tx
      .select({ id: entryFile.id })
      .from(entryFile)
      .where(
        and(
          eq(entryFile.id, input.entryFileId),
          eq(entryFile.fileAssetId, input.assetId),
          eq(entryFile.status, "live")
        )
      );
    if (!live) return false;
    await seedEntryDerivatives(tx, storage, {
      bucket,
      prefix,
      fileId: input.assetId,
      now,
    });
    return (
      (await queueStamp(tx, clock, {
        fileId: input.assetId,
        variant: "gallery",
      })) === "queued"
    );
  });
  if (queued)
    await renderStamp(
      {
        db,
        clock,
        storage,
        media: { ...unconfiguredMedia, ...stampProcessor() },
      },
      { fileId: input.assetId, variant: "gallery" }
    );
}

const id = (n: number) =>
  `01938a00-0000-7000-8000-000000131${String(n).padStart(3, "0")}`;
const lotCode = (n: number) => `LOT-27-5EED${n}`;
export const SEED_AUCTIONS = {
  manager: {
    id: id(100),
    email: "auction-manager@example.test",
    name: "Sample Auction Manager",
  },
  competitionCode: SEED_AUCTION_COMPETITION.code,
  open: lotCode(1),
  openBidPaise: 110000n,
  scheduled: lotCode(2),
  unsold: lotCode(3),
  cancelled: lotCode(4),
  paymentOffer: lotCode(5),
  paid: lotCode(6),
  paymentOfferMobile: lotCode(7),
  buyerMobile: {
    id: id(106),
    email: "auction-buyer-mobile@example.test",
    name: "Sample Mobile Auction Buyer",
  },
  mobileArtist: {
    id: id(107),
    email: "auction-mobile-artist@example.test",
    name: "Sample Mobile Auction Artist",
  },
  buyer: {
    id: id(101),
    email: "auction-buyer@example.test",
    name: "Sample Auction Buyer",
  },
  artist: {
    id: id(102),
    email: "auction-artist@example.test",
    name: "Sample Auction Artist",
  },
  otherArtist: {
    id: id(104),
    email: "auction-other-artist@example.test",
    name: "Another Auction Artist",
  },
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
  const [comp] = await db
    .select({ id: competition.id })
    .from(competition)
    .where(eq(competition.code, SEED_AUCTIONS.competitionCode));
  if (!comp) return;
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
  const buyer = await ensureVerifiedAccount(deps, SEED_AUCTIONS.buyer);
  const artist = await ensureVerifiedAccount(deps, SEED_AUCTIONS.artist);
  await db
    .insert(participantProfile)
    .values({
      id: id(103),
      ownerKind: "self",
      ownerUserId: artist.id,
      participantCode: "FOA-P-265EED05",
      fullName: artist.name,
      dobCiphertext: deps.cipher.encrypt(PROFILE_PURPOSE.dob, "1990-02-01"),
      identityHash: deps.blindIndex.of(
        IDENTITY_HASH_PURPOSE,
        "sample auction artist 1990-02-01"
      ),
      createdAt: now,
      updatedAt: now,
      createdBy: artist.id,
    })
    .onConflictDoNothing();
  const secondArtist = await ensureVerifiedAccount(
    deps,
    SEED_AUCTIONS.otherArtist
  );
  await db
    .insert(participantProfile)
    .values({
      id: id(105),
      ownerKind: "self",
      ownerUserId: secondArtist.id,
      participantCode: "FOA-P-265EED06",
      fullName: secondArtist.name,
      dobCiphertext: deps.cipher.encrypt(PROFILE_PURPOSE.dob, "1990-02-02"),
      identityHash: deps.blindIndex.of(
        IDENTITY_HASH_PURPOSE,
        "another auction artist 1990-02-02"
      ),
      createdAt: now,
      updatedAt: now,
      createdBy: secondArtist.id,
    })
    .onConflictDoNothing();
  const mobileBuyer = await ensureVerifiedAccount(
    deps,
    SEED_AUCTIONS.buyerMobile
  );
  const mobileArtist = await ensureVerifiedAccount(
    deps,
    SEED_AUCTIONS.mobileArtist
  );
  await db
    .insert(participantProfile)
    .values({
      id: id(108),
      ownerKind: "self",
      ownerUserId: mobileArtist.id,
      participantCode: "FOA-P-265EED07",
      fullName: mobileArtist.name,
      dobCiphertext: deps.cipher.encrypt(PROFILE_PURPOSE.dob, "1990-02-03"),
      identityHash: deps.blindIndex.of(
        IDENTITY_HASH_PURPOSE,
        "sample mobile auction artist 1990-02-03"
      ),
      createdAt: now,
      updatedAt: now,
      createdBy: mobileArtist.id,
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
    {
      profileId: id(105),
      age: 36,
      title: "A meadow of kindness",
      story: "A painting of a peaceful animal sanctuary.",
      status: "verified" as const,
    },
    {
      profileId: id(103),
      age: 36,
      title: "A woodland refuge",
      story: "A drawing celebrating the wild animals around us.",
      status: "retained" as const,
    },
    {
      profileId: id(108),
      age: 36,
      title: "Our forest friends",
      story: "A drawing of the animals and birds who share our world.",
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
            : n === 4
              ? []
              : n === 5 || n === 7
                ? ["awaiting_payment"]
                : ["sold"];
    for (const status of statuses) {
      const k =
        status === "open"
          ? 1
          : status === "scheduled"
            ? 2
            : status === "unsold"
              ? 3
              : status === "cancelled"
                ? 4
                : status === "awaiting_payment"
                  ? n === 7
                    ? 7
                    : 5
                  : 6;
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
          status: status as
            | "open"
            | "scheduled"
            | "unsold"
            | "cancelled"
            | "awaiting_payment"
            | "sold",
          story:
            work.story +
            (n <= 2
              ? " AI illustration; sample image, not actual participant artwork."
              : ""),
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
      if (n <= 2) {
        const [sample] = await db
          .select()
          .from(auctionLot)
          .where(
            and(
              eq(auctionLot.id, id(40 + k)),
              eq(auctionLot.consentEventId, consentId),
              eq(auctionLot.status, status as "open" | "scheduled")
            )
          );
        if (sample && (await currentLotConsent(deps, sample)))
          await seedLocalAuctionImage(deps, {
            entryId,
            assetId: id(70 + n),
            entryFileId: id(80 + n),
            ownerId: giver,
          });
      }
      if (inserted && status === "open") {
        await db
          .insert(auctionBid)
          .values({
            id: id(61),
            lotId: inserted.id,
            bidderUserId: SEED_ACCOUNTS.members[1].id,
            amountPaise: SEED_AUCTIONS.openBidPaise,
            declarationVersion: BID_DECLARATION_VERSION,
            placedAt: new Date(days(starts).getTime() + 3600_000),
          })
          .onConflictDoNothing();
      }
      if (inserted && (status === "awaiting_payment" || status === "sold")) {
        const bidId = id(60 + k),
          offerId = id(70 + k),
          paid = status === "sold";
        const offeredAt = days(-1),
          expiresAt = days(13);
        await db.transaction(async (tx) => {
          await tx.insert(auctionBid).values({
            id: bidId,
            lotId: inserted.id,
            bidderUserId: k === 7 ? mobileBuyer.id : buyer.id,
            amountPaise: 160101n,
            placedAt: days(-21),
            declarationVersion: BID_DECLARATION_VERSION,
          });
          if (paid)
            await tx.insert(paymentBatch).values({
              id: id(80 + k),
              purpose: "auction_sale",
              payerUserId: buyer.id,
              status: "captured",
              amountMinor: 160101n,
              gateway: "fallback",
              gatewayOrderId: `seed_auction_order_${k}`,
              gatewayPaymentId: `seed_auction_payment_${k}`,
              captureMethod: "gateway",
              capturedAt: now,
              createdAt: offeredAt,
              updatedAt: now,
            });
          await tx.insert(auctionOffer).values({
            id: offerId,
            lotId: inserted.id,
            bidId,
            lotCode: lotCode(k),
            competitionId: comp.id,
            status: paid ? "paid" : "open",
            amountPaise: 160101n,
            creatorShareBps: paid ? 2500 : 0,
            offeredAt,
            expiresAt,
            ...(paid
              ? {
                  batchId: id(80 + k),
                  paidAt: now,
                  deliveryStatus: "receipt_confirmed" as const,
                  deliveryUpdatedAt: now,
                }
              : {}),
          });
          await tx.insert(artworkCustodyEvent).values({
            id: id(50 + k),
            artworkId,
            kind: "auction_reserved",
            location: "Sample archive shelf",
            actorUserId: manager.id,
            at: days(-31),
          });
          if (paid)
            await postToLedger(
              tx,
              { actor: { kind: "system", process: "seed" }, clock },
              {
                source: { type: "auction_sale", id: offerId },
                competitionId: comp.id,
                occurredAt: now,
                description: "Sample auction sale",
                lines: auctionCaptureLines({
                  amountPaise: 160101n,
                  creatorShareBps: 2500,
                }),
              }
            );
          else {
            const aggregate = { type: "auction_offer" as const, id: offerId },
              payload = { offerId };
            await emit(tx, clock, {
              type: "auction.offer_opened",
              aggregate,
              payload,
            });
            await emit(
              tx,
              clock,
              { type: "auction.offer.expire", aggregate, payload },
              { availableAt: expiresAt }
            );
          }
        });
      }
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
        const aggregate = { type: "auction_lot" as const, id: inserted.id };
        const payload = { lotId: inserted.id };
        if (status === "scheduled") {
          await emit(
            db,
            clock,
            { type: "auction.lot.open", aggregate, payload },
            { availableAt: days(starts) }
          );
        }
        await emit(
          db,
          clock,
          { type: "auction.lot.close", aggregate, payload },
          { availableAt: days(ends) }
        );
      }
    }
  }
};
