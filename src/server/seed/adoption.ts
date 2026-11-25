// Adoption seed data (#129): animals listed by the seeded directory
// listings (#127), so a preview's /adopt has something to browse and
// filter, and the NGO's representative has a draft, a published, an
// on-hold and an adopted animal to manage. One published animal belongs to
// the suspended foster home, so it stays hidden.
//
// Each animal has one photo. Its resized copies are made from an FOA
// sample illustration (an AI illustration standing in for a photo, and
// its text alternative says so) and written to `storage` when the seed
// has one; the original is never written. Without storage the photos stay
// "processing" and the cards show no picture.
//
// Seed data: no audit entry. Idempotent: rows already there are left
// alone, so changes made on a preview survive a reseed.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { eq } from "drizzle-orm";

import type { AppDb } from "../db/app-db";
import {
  adoptionListing,
  adoptionListingPhoto,
  fileAsset,
  fileDerivative,
  fileProcessing,
} from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { uuidv7 } from "../ids";
import type { AdoptionListingDetails } from "../modules/adoption/domain/details";
import type { AdoptionListingStatus } from "../modules/adoption/domain/status";
import { detailsColumns } from "../modules/adoption/stored";
import {
  derivativeKeyFor,
  derivativeKindsFor,
} from "../modules/files/domain/media-work";
import type { DerivativeKind } from "../modules/files/domain/derivatives";
import { storageKeyFor } from "../modules/files/domain/storage-key";
import type { ObjectStorage } from "../ports/storage";
import { SEED_DIRECTORY } from "./directory";
import { seedFilesLocation } from "./files";
import { resizedArt } from "./resized-art";
import type { SeedDeps, Seeder } from "./types";

const DAY = 24 * 60 * 60 * 1000;

const ids = (n: number) => ({
  id: `01938a00-0000-7000-8000-0000000129${String(n).padStart(2, "0")}`,
  photoId: `01938a00-0000-7000-8000-0000000129${String(n + 40).padStart(2, "0")}`,
  fileId: `01938a00-0000-7000-8000-0000000129${String(n + 70).padStart(2, "0")}`,
});

type Art =
  | "portraits/portrait-indie-dog"
  | "portraits/portrait-street-cat"
  | "portraits/portrait-house-sparrow"
  | "portraits/portrait-cow"
  | "waiting/wait-calendar-pup"
  | "waiting/wait-mailbox-cat";

type SeedAnimal = {
  n: number;
  slug: string;
  directoryListingId: string;
  status: AdoptionListingStatus;
  /** Days before the seed ran that it was first published. */
  publishedDaysAgo: number | null;
  art: Art;
  details: Omit<
    AdoptionListingDetails,
    "about" | "healthNotes" | "vaccinationNotes" | "conditions" | "state"
  > &
    Partial<AdoptionListingDetails>;
};

const { ngo, rescuer, suspended } = SEED_DIRECTORY;

/** Fixed slugs, so links and Seam 2 journeys can name them. */
export const SEED_ADOPTION = {
  published: "seed-bruno-dog-pune",
  onHold: "seed-sheru-dog-pune",
  adopted: "seed-moti-cat-pune",
  draft: "seed-chutki-cat-pune",
  /** Published, but its foster home is suspended: hidden. */
  hidden: "seed-tara-dog-satara",
  /** The NGO's draft, for its representative to finish. */
  draftId: ids(4).id,
  publishedId: ids(1).id,
  /** The adopted cat and a published one, for #130's seeded applications. */
  adoptedId: ids(3).id,
  raniId: ids(5).id,
} as const;

const ANIMALS: readonly SeedAnimal[] = [
  {
    n: 1,
    slug: SEED_ADOPTION.published,
    directoryListingId: ngo.id,
    status: "published",
    publishedDaysAgo: 2,
    art: "portraits/portrait-indie-dog",
    details: {
      name: "Seed Bruno",
      species: "dog",
      breed: "Indie",
      sex: "male",
      size: "medium",
      colour: "Fawn with a white blaze",
      age: { years: 2, months: 1 },
      sterilised: true,
      city: "Pune",
      pinCode: "411001",
    },
  },
  {
    n: 2,
    slug: SEED_ADOPTION.onHold,
    directoryListingId: ngo.id,
    status: "on_hold",
    publishedDaysAgo: 9,
    art: "waiting/wait-calendar-pup",
    details: {
      name: "Seed Sheru",
      species: "dog",
      breed: null,
      sex: "male",
      size: "small",
      colour: "Brown",
      age: { years: 0, months: 4 },
      sterilised: false,
      city: "Pune",
      pinCode: "411004",
    },
  },
  {
    n: 3,
    slug: SEED_ADOPTION.adopted,
    directoryListingId: ngo.id,
    status: "adopted",
    publishedDaysAgo: 20,
    art: "portraits/portrait-street-cat",
    details: {
      name: "Seed Moti",
      species: "cat",
      breed: null,
      sex: "female",
      size: "small",
      colour: "Orange and white",
      age: { years: 3, months: 0 },
      sterilised: true,
      city: "Pune",
      pinCode: "411001",
    },
  },
  {
    n: 4,
    slug: SEED_ADOPTION.draft,
    directoryListingId: ngo.id,
    status: "draft",
    publishedDaysAgo: null,
    art: "waiting/wait-mailbox-cat",
    details: {
      name: "Seed Chutki",
      species: "cat",
      breed: null,
      sex: "female",
      size: "small",
      colour: "Grey tabby",
      age: { years: 0, months: 7 },
      sterilised: null,
      city: "Pune",
      pinCode: "411001",
    },
  },
  {
    n: 5,
    slug: "seed-rani-cat-pune",
    directoryListingId: ngo.id,
    status: "published",
    publishedDaysAgo: 3,
    art: "waiting/wait-mailbox-cat",
    details: {
      name: "Seed Rani",
      species: "cat",
      breed: null,
      sex: "female",
      size: "small",
      colour: "Grey tabby",
      age: { years: 0, months: 5 },
      sterilised: false,
      city: "Pune",
      pinCode: "411002",
    },
  },
  {
    n: 6,
    slug: "seed-gauri-other-mumbai",
    directoryListingId: ngo.id,
    status: "published",
    publishedDaysAgo: 4,
    art: "portraits/portrait-cow",
    details: {
      name: "Seed Gauri",
      species: "other",
      breed: "Gir calf",
      sex: "female",
      size: "large",
      colour: "Red-brown",
      age: { years: 1, months: 2 },
      sterilised: null,
      city: "Mumbai",
      pinCode: "400001",
      conditions:
        "Seed data: a farm or sanctuary with open grazing. FOA visits before the adoption.",
    },
  },
  {
    n: 7,
    slug: "seed-chiku-bird-pimpri-chinchwad",
    directoryListingId: rescuer.id,
    status: "published",
    publishedDaysAgo: 5,
    art: "portraits/portrait-house-sparrow",
    details: {
      name: "Seed Chiku",
      species: "bird",
      breed: null,
      sex: "unknown",
      size: null,
      colour: "Brown",
      age: { years: 0, months: 9 },
      sterilised: null,
      city: "Pimpri-Chinchwad",
      pinCode: "411018",
    },
  },
  {
    n: 8,
    slug: "seed-kalu-dog-pimpri-chinchwad",
    directoryListingId: rescuer.id,
    status: "published",
    publishedDaysAgo: 6,
    art: "portraits/portrait-indie-dog",
    details: {
      name: "Seed Kalu",
      species: "dog",
      breed: "Indie",
      sex: "male",
      size: "large",
      colour: "Black",
      age: { years: 9, months: 0 },
      sterilised: true,
      city: "Pimpri-Chinchwad",
      pinCode: "411018",
    },
  },
  {
    n: 9,
    slug: "seed-mithu-cat-mumbai",
    directoryListingId: rescuer.id,
    status: "published",
    publishedDaysAgo: 7,
    art: "portraits/portrait-street-cat",
    details: {
      name: "Seed Mithu",
      species: "cat",
      breed: null,
      sex: "male",
      size: "medium",
      colour: "Orange and white",
      age: { years: 5, months: 6 },
      sterilised: true,
      city: "Mumbai",
      pinCode: "400050",
    },
  },
  {
    n: 10,
    slug: SEED_ADOPTION.hidden,
    directoryListingId: suspended.id,
    status: "published",
    publishedDaysAgo: 30,
    art: "waiting/wait-calendar-pup",
    details: {
      name: "Seed Tara",
      species: "dog",
      breed: null,
      sex: "female",
      size: "small",
      colour: "Brown",
      age: { years: 1, months: 0 },
      sterilised: true,
      city: "Satara",
      pinCode: "415001",
    },
  },
];

const SPECIES_WORDS: Record<AdoptionListingDetails["species"], string> = {
  dog: "dog",
  cat: "cat",
  rabbit: "rabbit",
  bird: "bird",
  other: "calf",
};

function fullDetails(animal: SeedAnimal): AdoptionListingDetails {
  const name = animal.details.name;
  return {
    about: `Seed data: ${name} is calm with people and other animals.`,
    healthNotes: "Seed data: healthy at the last check-up. Dewormed.",
    vaccinationNotes: "Seed data: anti-rabies, up to date.",
    conditions:
      "Seed data: a home visit before the adoption, and a check-in call after a month.",
    state: "maharashtra",
    ...animal.details,
  };
}

const KINDS = derivativeKindsFor({
  purpose: "adoption_photo",
  contentType: "image/webp",
});

type Made = {
  kind: DerivativeKind;
  width: number;
  height: number;
  bytes: Uint8Array;
};

function copiesOf(art: Art): Promise<Made[]> {
  return resizedArt(
    new URL(`../../assets/site-art/${art}.webp`, import.meta.url),
    KINDS
  );
}

/** Writes the photo's copies and their rows, unless all are there. */
async function seedCopies(
  db: AppDb,
  storage: Pick<ObjectStorage, "write">,
  {
    bucket,
    prefix,
    fileId,
    art,
    now,
  }: {
    bucket: string;
    prefix: string;
    fileId: string;
    art: Art;
    now: Date;
  }
) {
  const made = await db
    .select({ kind: fileDerivative.kind })
    .from(fileDerivative)
    .where(eq(fileDerivative.fileAssetId, fileId));
  if (KINDS.every((kind) => made.some((row) => row.kind === kind))) return;
  for (const { kind, width, height, bytes } of await copiesOf(art)) {
    const key = derivativeKeyFor({ prefix, fileId, kind });
    await storage.write({
      bucket,
      key,
      body: bytes,
      contentType: "image/webp",
    });
    await db
      .insert(fileDerivative)
      .values({
        id: uuidv7(now),
        fileAssetId: fileId,
        kind,
        bucket,
        storageKey: key,
        contentType: "image/webp",
        width,
        height,
        sizeBytes: bytes.length,
        createdAt: now,
      })
      .onConflictDoNothing();
  }
}

async function ownerOf(deps: SeedDeps, directoryListingId: string) {
  const account =
    directoryListingId === ngo.id
      ? ngo.representative
      : directoryListingId === rescuer.id
        ? rescuer.representative
        : suspended.representative;
  return ensureVerifiedAccount(deps, account);
}

export const seedAdoption: Seeder = async (deps) => {
  const now = deps.clock.now();
  const { bucket, keyPrefix: prefix } = seedFilesLocation();
  // Resize every illustration at once (sharp works off the main thread)
  // rather than one by one inside the loop.
  await Promise.all([...new Set(ANIMALS.map((a) => a.art))].map(copiesOf));
  for (const animal of ANIMALS) {
    const { id, photoId, fileId } = ids(animal.n);
    const owner = await ownerOf(deps, animal.directoryListingId);
    const details = fullDetails(animal);
    const publishedAt =
      animal.publishedDaysAgo === null
        ? null
        : new Date(now.getTime() - animal.publishedDaysAgo * DAY);
    const createdAt = new Date((publishedAt ?? now).getTime() - 1 * DAY);
    const closed = animal.status === "adopted" || animal.status === "withdrawn";
    await deps.db.transaction(async (tx) => {
      await tx
        .insert(adoptionListing)
        .values({
          id,
          directoryListingId: animal.directoryListingId,
          slug: animal.slug,
          ...detailsColumns(details, now),
          status: animal.status,
          publishedAt,
          closedAt: closed ? now : null,
          createdByUserId: owner.id,
          createdAt,
          updatedAt: createdAt,
        })
        .onConflictDoNothing();
      await tx
        .insert(fileAsset)
        .values({
          id: fileId,
          ownerUserId: owner.id,
          purpose: "adoption_photo",
          contentType: "image/webp",
          sizeBytes: 20_000,
          bucket,
          storageKey: storageKeyFor({
            prefix,
            purpose: "adoption_photo",
            fileId,
          }),
          status: "clean",
          uploadedAt: createdAt,
          createdAt,
          updatedAt: createdAt,
        })
        .onConflictDoNothing();
      await tx
        .insert(adoptionListingPhoto)
        .values({
          id: photoId,
          listingId: id,
          fileAssetId: fileId,
          position: 1,
          altText: `AI illustration standing in for a photo: ${details.name}, a ${SPECIES_WORDS[details.species]}`,
          createdAt,
        })
        .onConflictDoNothing();
      if (!deps.storage) {
        await tx
          .insert(fileProcessing)
          .values({
            fileAssetId: fileId,
            status: "queued",
            queuedAt: createdAt,
            updatedAt: createdAt,
          })
          .onConflictDoNothing();
        return;
      }
      await seedCopies(tx, deps.storage, {
        bucket,
        prefix,
        fileId,
        art: animal.art,
        now,
      });
      // A seed made without storage left it queued: its copies exist now.
      await tx
        .insert(fileProcessing)
        .values({
          fileAssetId: fileId,
          status: "done",
          queuedAt: createdAt,
          finishedAt: createdAt,
          updatedAt: createdAt,
        })
        .onConflictDoUpdate({
          target: fileProcessing.fileAssetId,
          set: { status: "done", finishedAt: createdAt, updatedAt: createdAt },
        });
    });
  }
};
