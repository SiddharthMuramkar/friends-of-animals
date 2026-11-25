// NGO directory seed data (#127): a verified NGO whose representative is a
// seeded member, a verified independent rescuer, a shelter waiting for
// review with a document, one rejected and one suspended listing, so a
// preview's staff queue, the public page and the representative's page
// have something in each state. For the search (#128), sample centres for
// a handful of pin codes around Pune and Mumbai (SAMPLE_PINCODE_CENTRES):
// rounded coordinates, not India Post's data, which waits on HR-59. Placeholder details only: example.test
// addresses and numbers in a block no real subscriber holds. Loads under
// plain Node (the seed script): relative imports only, no "server-only".

import type { E164Phone } from "../../lib/phone";
import {
  directoryListing,
  directoryListingDocument,
  fileAsset,
} from "../db/schema";
import { ensureVerifiedAccount } from "../identity/verified-account";
import { uuidv7 } from "../ids";
import type {
  DirectoryService,
  ListingType,
} from "../modules/directory/domain/catalogue";
import type { ListingStatus } from "../modules/directory/domain/listing-status";
import type { PincodeCentre } from "../modules/directory/domain/pincode-import";
import { listingSlugBase } from "../modules/directory/domain/slug";
import { savePincodeCentres } from "../modules/directory/pincodes";
import { storageKeyFor } from "../modules/files/domain/storage-key";
import { sealListingDetails } from "../modules/directory/stored-listing";
import { ensureGrant } from "./access";
import { seedFilesLocation } from "./files";
import type { SeedDeps } from "./types";

const DAY = 24 * 60 * 60 * 1000;

const account = (n: number, name: string, email: string) => ({
  id: `01938a00-0000-7000-8000-00000000127${n}`,
  name,
  email,
});

/** Fixed ids, so links and Seam 2 journeys can name them. */
export const SEED_DIRECTORY = {
  ngo: {
    id: "01938a00-0000-7000-8000-000000012701",
    slug: "seed-paws-trust",
    name: "Seed Paws Trust",
    /** Registered it, and represents it since FOA verified it. */
    representative: account(
      1,
      "Nisha Kulkarni",
      "directory-representative@example.test"
    ),
  },
  rescuer: {
    id: "01938a00-0000-7000-8000-000000012702",
    slug: "seed-street-rescues",
    name: "Seed Street Rescues",
    representative: account(2, "Ravi Street", "directory-rescuer@example.test"),
  },
  pending: {
    id: "01938a00-0000-7000-8000-000000012703",
    slug: "seed-safe-haven-shelter",
    name: "Seed Safe Haven Shelter",
    applicant: account(3, "Farah Khan", "directory-applicant@example.test"),
    documentId: "01938a00-0000-7000-8000-000000012711",
    fileId: "01938a00-0000-7000-8000-000000012712",
  },
  /** The applicant's first try, before the pending one. */
  rejected: {
    id: "01938a00-0000-7000-8000-000000012704",
    slug: "seed-safe-haven-trust",
    name: "Seed Safe Haven Trust",
  },
  suspended: {
    id: "01938a00-0000-7000-8000-000000012705",
    slug: "seed-quiet-paws-foster",
    name: "Seed Quiet Paws Foster Home",
    representative: account(
      4,
      "Quentin Dsouza",
      "directory-foster@example.test"
    ),
  },
} as const;

/**
 * Sample pin-code centres, so a preview's search finds the seeded
 * listings: two decimals, about a kilometre, from public maps. Not India
 * Post's directory: its import waits on HR-59. Saved again on every seed.
 */
export const SAMPLE_PINCODE_CENTRES: readonly PincodeCentre[] = [
  centre("411001", 18.52, 73.86, "Pune"),
  centre("411004", 18.52, 73.84, "Pune"),
  centre("411038", 18.51, 73.81, "Pune"),
  centre("411014", 18.57, 73.91, "Pune"),
  centre("411018", 18.63, 73.8, "Pune"),
  centre("412105", 18.68, 73.9, "Pune"),
  centre("410506", 18.73, 73.68, "Pune"),
  centre("415001", 17.69, 74.0, "Satara"),
  centre("422001", 20.0, 73.79, "Nashik"),
  centre("400001", 18.94, 72.84, "Mumbai"),
];

function centre(
  pinCode: string,
  latitude: number,
  longitude: number,
  district: string
): PincodeCentre {
  return {
    pinCode,
    latitude,
    longitude,
    district,
    state: "Maharashtra",
    postOffices: 1,
  };
}

type SeedListing = {
  id: string;
  slug: string;
  name: string;
  type: ListingType;
  services: DirectoryService[];
  city: string;
  pinCode: string;
  number: number;
  ownerUserId: string;
  registeredDaysAgo: number;
  status: ListingStatus;
  reason: string | null;
  /** Shown on its public page: every listing here shows its phone. */
  publicEmail: boolean;
};

/** The row for `seed`, with its status applied as of `now`. */
function rowFor(deps: SeedDeps, seed: SeedListing, now: Date) {
  const registeredAt = new Date(now.getTime() - seed.registeredDaysAgo * DAY);
  const decidedAt = new Date(registeredAt.getTime() + 2 * DAY);
  const decided = seed.status !== "pending_verification";
  const everVerified =
    seed.status === "verified" || seed.status === "suspended";
  return {
    id: seed.id,
    slug: seed.slug,
    ...sealListingDetails(deps, {
      type: seed.type,
      name: seed.name,
      description: `Seed data: ${seed.name} looks after animals in and around ${seed.city}.`,
      services: seed.services,
      address: `${seed.number} Seed Lane`,
      city: seed.city,
      state: "Maharashtra",
      pinCode: seed.pinCode,
      contactPhone: `+9190000012${seed.number}0` as E164Phone,
      contactEmail: `listing${seed.number}@example.test`,
      website: null,
      publicContactFields: seed.publicEmail ? ["phone", "email"] : ["phone"],
    }),
    status: seed.status,
    statusReason: seed.reason,
    statusChangedAt: decided ? decidedAt : registeredAt,
    // Seed data, not a staff decision: it names no staff member.
    verifiedAt: everVerified ? decidedAt : null,
    ownerUserId: seed.ownerUserId,
    createdAt: registeredAt,
    updatedAt: decided ? decidedAt : registeredAt,
  };
}

/**
 * The five listings, unless rows with their ids exist already (a staff
 * decision on a preview survives every later seed), the representatives'
 * grants, and the pending shelter's document (metadata only).
 */
export async function seedDirectory(deps: SeedDeps): Promise<void> {
  const now = deps.clock.now();
  await savePincodeCentres(deps, SAMPLE_PINCODE_CENTRES);
  const { ngo, rescuer, pending, rejected, suspended } = SEED_DIRECTORY;
  const ngoOwner = await ensureVerifiedAccount(deps, ngo.representative);
  const rescuerOwner = await ensureVerifiedAccount(
    deps,
    rescuer.representative
  );
  const applicant = await ensureVerifiedAccount(deps, pending.applicant);
  const fosterOwner = await ensureVerifiedAccount(
    deps,
    suspended.representative
  );
  const listings: SeedListing[] = [
    {
      ...pick(ngo),
      type: "ngo",
      services: ["rescue", "veterinary_care", "sterilisation", "adoption"],
      city: "Pune",
      pinCode: "411001",
      number: 1,
      ownerUserId: ngoOwner.id,
      registeredDaysAgo: 40,
      status: "verified",
      reason: "Seed data: checked the trust deed",
      publicEmail: true,
    },
    {
      ...pick(rescuer),
      type: "independent_rescuer",
      services: ["rescue", "feeding"],
      city: "Pimpri-Chinchwad",
      pinCode: "411018",
      number: 2,
      ownerUserId: rescuerOwner.id,
      registeredDaysAgo: 30,
      status: "verified",
      reason: "Seed data: checked the rescuer's identity",
      publicEmail: false,
    },
    {
      ...pick(rejected),
      type: "shelter",
      services: ["shelter"],
      city: "Nashik",
      pinCode: "422001",
      number: 4,
      ownerUserId: applicant.id,
      registeredDaysAgo: 20,
      status: "rejected",
      reason: "Seed data: the registration certificate was missing",
      publicEmail: true,
    },
    {
      ...pick(pending),
      type: "shelter",
      services: ["shelter", "adoption", "fostering"],
      city: "Nashik",
      pinCode: "422001",
      number: 3,
      ownerUserId: applicant.id,
      registeredDaysAgo: 3,
      status: "pending_verification",
      reason: null,
      publicEmail: true,
    },
    {
      ...pick(suspended),
      type: "foster_caregiver",
      services: ["fostering"],
      city: "Satara",
      pinCode: "415001",
      number: 5,
      ownerUserId: fosterOwner.id,
      registeredDaysAgo: 50,
      status: "suspended",
      reason: "Seed data: paused while FOA looks into a complaint",
      publicEmail: false,
    },
  ];
  for (const seed of listings) {
    // Also skips a row its person can't hold: one open listing each.
    await deps.db
      .insert(directoryListing)
      .values(rowFor(deps, seed, now))
      .onConflictDoNothing();
  }
  for (const [owner, listingId] of [
    [ngoOwner, ngo.id],
    [rescuerOwner, rescuer.id],
    [fosterOwner, suspended.id],
  ] as const) {
    await ensureGrant(deps, owner.id, {
      role: "organisation_representative",
      scope: { type: "organisation", id: listingId },
    });
  }

  const { bucket, keyPrefix } = seedFilesLocation();
  const registeredAt = new Date(now.getTime() - 3 * DAY);
  await deps.db
    .insert(fileAsset)
    .values({
      id: pending.fileId,
      ownerUserId: applicant.id,
      purpose: "directory_document",
      contentType: "application/pdf",
      sizeBytes: 68,
      bucket,
      storageKey: storageKeyFor({
        prefix: keyPrefix,
        purpose: "directory_document",
        fileId: pending.fileId,
      }),
      status: "clean",
      uploadedAt: registeredAt,
      createdAt: registeredAt,
      updatedAt: registeredAt,
    })
    .onConflictDoNothing();
  await deps.db
    .insert(directoryListingDocument)
    .values({
      id: pending.documentId,
      listingId: pending.id,
      fileAssetId: pending.fileId,
      kind: "registration_certificate",
      createdAt: registeredAt,
    })
    .onConflictDoNothing();
}

function pick(listing: { id: string; slug: string; name: string }) {
  return { id: listing.id, slug: listing.slug, name: listing.name };
}

/**
 * A listing for tests (#128 and #129 build on it): registered by a new
 * member, in `status` (verified unless told), with no audit entry and no
 * message. A verified or suspended one's owner holds the representative
 * role.
 */
export function directoryListingBuilder(deps: SeedDeps) {
  let made = 0;
  return async (
    options: {
      status?: ListingStatus;
      name?: string;
      type?: ListingType;
      services?: DirectoryService[];
      pinCode?: string;
      city?: string;
    } = {}
  ) => {
    made += 1;
    const now = deps.clock.now();
    const id = uuidv7(now);
    const name = options.name ?? `Test Listing ${made}`;
    const owner = await ensureVerifiedAccount(deps, {
      name: `Listing Owner ${made}`,
      email: `listing-owner-${made}-${id.slice(-8)}@example.test`,
    });
    const status = options.status ?? "verified";
    const row = rowFor(
      deps,
      {
        id,
        slug: `${listingSlugBase(name)}-${id.slice(-8)}`,
        name,
        type: options.type ?? "ngo",
        services: options.services ?? ["rescue"],
        city: options.city ?? "Pune",
        pinCode: options.pinCode ?? "411001",
        number: made % 10,
        ownerUserId: owner.id,
        registeredDaysAgo: 0,
        status,
        reason:
          status === "pending_verification" ? null : "Recorded by the test",
        publicEmail: true,
      },
      now
    );
    await deps.db.insert(directoryListing).values(row);
    if (status === "verified" || status === "suspended") {
      await ensureGrant(deps, owner.id, {
        role: "organisation_representative",
        scope: { type: "organisation", id },
      });
    }
    return { listingId: id, slug: row.slug, owner };
  };
}

/** Saves pin-code centres as given, for tests of the search (#128). */
export function pincodeCentresBuilder(deps: SeedDeps) {
  return (centres: readonly PincodeCentre[]) =>
    savePincodeCentres(deps, centres);
}
