// Test helpers for the adoption module (#129). Tests only: nothing in the
// app imports this file.

import type { Harness } from "@/test/harness";
import { readMediaFixture } from "@/test/media-fixtures";

import type { ListingStatus } from "../directory/domain/listing-status";
import type { AdoptionListingDetailsInput } from "./domain/details";

/** A complete, valid form: Bruno, a two-year-old dog in Pune. */
export const BRUNO: AdoptionListingDetailsInput = {
  name: "Bruno",
  species: "dog",
  breed: "Indie",
  sex: "male",
  size: "medium",
  colour: "Brown and white",
  age: { years: 2, months: 1 },
  sterilised: true,
  about: "Calm, loves long walks.",
  healthNotes: "Healthy. Dewormed in December.",
  vaccinationNotes: "Anti-rabies and DHPPi, December 2026.",
  conditions: "Indoor home only. Home visit before adoption.",
  state: "maharashtra",
  city: "Pune",
  pinCode: "411001",
};

/**
 * A directory listing in `status` (verified unless told) and its
 * representative, signed in. A pending, rejected or withdrawn listing's
 * owner holds no representative role.
 */
export async function representative(
  h: Harness,
  status: ListingStatus = "verified",
  options: { name?: string } = {}
) {
  const directory = await h.seed.directoryListing({ status, ...options });
  const actor = await h.signIn(directory.owner);
  return { ...directory, actor };
}

/** A signed-in member who represents nothing. */
export async function member(h: Harness) {
  return h.signIn(await h.seed.member());
}

/** A signed-in staff admin (second factor passed). */
export async function staffAdmin(h: Harness) {
  const user = await h.seed.member();
  await h.seed.grant(user, { role: "staff_admin", scope: { type: "global" } });
  return h.signIn(user);
}

type Rep = Awaited<ReturnType<typeof representative>>;

/** A draft of `details` (Bruno, by default) under `rep`'s listing. */
export async function draft(
  h: Harness,
  rep: Rep,
  details: Partial<AdoptionListingDetailsInput> = {}
) {
  const created = await h.as(rep.actor).createAdoptionListing({
    directoryListingId: rep.listingId,
    ...BRUNO,
    ...details,
  });
  if (!created.ok) throw new Error(`Could not create: ${created.error}`);
  return created;
}

/**
 * Uploads a JPEG as a photo of `adoptionListingId`, completes it and, by
 * default, drains the outbox so it is scanned and its copies made.
 */
export async function addPhoto(
  h: Harness,
  rep: Rep,
  adoptionListingId: string,
  { altText = "Bruno sitting on a step", process = true } = {}
) {
  const bytes = readMediaFixture("gpsJpeg");
  const upload = await h.as(rep.actor).requestAdoptionPhotoUpload({
    adoptionListingId,
    altText,
    contentType: "image/jpeg",
    sizeBytes: bytes.length,
  });
  if (!upload.ok) throw new Error(`Could not presign: ${upload.error}`);
  await h.storage.put(upload.uploadUrl, bytes, upload.headers);
  const done = await h.as(rep.actor).completeUpload({ fileId: upload.fileId });
  if (!done.ok) throw new Error(`Could not complete: ${done.error}`);
  if (process) await h.drain();
  return upload;
}

/** A published animal with one ready photo. */
export async function published(
  h: Harness,
  rep: Rep,
  details: Partial<AdoptionListingDetailsInput> = {}
) {
  const created = await draft(h, rep, details);
  const photo = await addPhoto(h, rep, created.adoptionListingId);
  const result = await h
    .as(rep.actor)
    .publishAdoptionListing({ adoptionListingId: created.adoptionListingId });
  if (!result.ok) throw new Error(`Could not publish: ${result.error}`);
  return { ...created, photoId: photo.photoId, fileId: photo.fileId };
}
