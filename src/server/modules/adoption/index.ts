// The adoption module (#129): animals a verified directory listing (#127)
// offers for adoption, their photos, the status machine and the public
// browse. Applications and the coordinator's workflow (#130) build on it.
// Its use cases join `as(actor)` through `adoptionUseCases`.

import type { UseCaseContext } from "../../use-cases";
import {
  createAdoptionListing,
  type CreateAdoptionListingInput,
} from "./create";
import {
  holdAdoptionListing,
  publishAdoptionListing,
  resumeAdoptionListing,
  withdrawAdoptionListing,
  type AdoptionMoveInput,
} from "./lifecycle";
import { getAdoptionListingForOwner, listAdoptionListings } from "./owner-read";
import { readAdoptionPhoto } from "./photo-read";
import {
  describeAdoptionPhoto,
  removeAdoptionPhoto,
  requestAdoptionPhotoUpload,
  type RequestAdoptionPhotoUploadInput,
} from "./photos";
import {
  adoptableAnimalSlugs,
  browseAdoptableAnimals,
  getAdoptableAnimal,
  type BrowseAdoptableAnimalsInput,
} from "./public-read";
import {
  updateAdoptionListing,
  type UpdateAdoptionListingInput,
} from "./update";

export type {
  CreateAdoptionListingInput,
  CreateAdoptionListingResult,
} from "./create";
export type {
  AdoptionMoveInput,
  AdoptionMoveResult,
  PublishAdoptionListingResult,
} from "./lifecycle";
export type {
  AdoptionListingForOwner,
  AdoptionListingSummary,
  GetAdoptionListingForOwnerResult,
  ListAdoptionListingsResult,
  OwnerMoves,
} from "./owner-read";
export type { ReadAdoptionPhotoResult } from "./photo-read";
export type {
  PhotoState,
  PhotoVariant,
  PublicPhoto,
  StoredPhoto,
} from "./photo-rows";
export type {
  AdoptionPhotoChangeResult,
  RequestAdoptionPhotoUploadInput,
  RequestAdoptionPhotoUploadResult,
} from "./photos";
export type {
  AdoptableAnimal,
  AdoptableAnimalCard,
  AdoptionOrganisation,
  BrowseAdoptableAnimalsInput,
  BrowseAdoptableAnimalsResult,
  GetAdoptableAnimalResult,
} from "./public-read";
export type {
  UpdateAdoptionListingInput,
  UpdateAdoptionListingResult,
} from "./update";
export { adoptionPhotoPath } from "./photo-rows";
export {
  transitionAdoptionListing,
  type TransitionAdoptionListingInput,
  type TransitionAdoptionListingResult,
} from "./transition";
export { ADOPTION_TAGS } from "./tags";

export const adoptionUseCases = (ctx: UseCaseContext) => ({
  createAdoptionListing: (input: CreateAdoptionListingInput) =>
    createAdoptionListing(ctx, input),
  updateAdoptionListing: (input: UpdateAdoptionListingInput) =>
    updateAdoptionListing(ctx, input),
  requestAdoptionPhotoUpload: (input: RequestAdoptionPhotoUploadInput) =>
    requestAdoptionPhotoUpload(ctx, input),
  describeAdoptionPhoto: (input: { photoId: string; altText: string }) =>
    describeAdoptionPhoto(ctx, input),
  removeAdoptionPhoto: (input: { photoId: string }) =>
    removeAdoptionPhoto(ctx, input),
  publishAdoptionListing: (input: AdoptionMoveInput) =>
    publishAdoptionListing(ctx, input),
  holdAdoptionListing: (input: AdoptionMoveInput) =>
    holdAdoptionListing(ctx, input),
  resumeAdoptionListing: (input: AdoptionMoveInput) =>
    resumeAdoptionListing(ctx, input),
  withdrawAdoptionListing: (input: AdoptionMoveInput) =>
    withdrawAdoptionListing(ctx, input),
  listAdoptionListings: (input: { directoryListingId: string }) =>
    listAdoptionListings(ctx, input),
  getAdoptionListingForOwner: (input: { adoptionListingId: string }) =>
    getAdoptionListingForOwner(ctx, input),
  browseAdoptableAnimals: (input: BrowseAdoptableAnimalsInput = {}) =>
    browseAdoptableAnimals(ctx, input),
  getAdoptableAnimal: (input: { slug: string }) =>
    getAdoptableAnimal(ctx, input),
  adoptableAnimalSlugs: () => adoptableAnimalSlugs(ctx),
  readAdoptionPhoto: (input: { photoId: string; kind: string }) =>
    readAdoptionPhoto(ctx, input),
});
