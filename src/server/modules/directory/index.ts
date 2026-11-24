// The directory module (#127): NGO directory listings, their registration
// by an organisation or an individual rescuer, FOA staff's verification,
// the public read of a verified listing, and search by service and
// distance (#128). Adoption listings (#129) build on it. Its use cases
// join `as(actor)` through `directoryUseCases`.

import type { UseCaseContext } from "../../use-cases";
import {
  reinstateListing,
  rejectListing,
  suspendListing,
  verifyListing,
  type DecideListingInput,
} from "./decide";
import {
  getListingDocumentUrl,
  requestListingDocumentUpload,
  type RequestListingDocumentUploadInput,
} from "./documents";
import type { ListingDetailsInput } from "./domain/listing-input";
import { getPublicListing, publicListingSlugs } from "./public";
import {
  getListingForReview,
  getMyListing,
  listListingsForReview,
  listMyListings,
  type ListListingsForReviewInput,
} from "./queries";
import { registerListing } from "./register";
import { searchListings, type SearchListingsInput } from "./search";
import {
  updateListing,
  withdrawListing,
  type UpdateListingInput,
  type WithdrawListingInput,
} from "./update";

export type { DecideListingInput, DecideListingResult } from "./decide";
export type {
  GetListingDocumentUrlResult,
  RequestListingDocumentUploadInput,
  RequestListingDocumentUploadResult,
} from "./documents";
export type {
  ListingDetails,
  ListingDetailsInput,
  ListingField,
} from "./domain/listing-input";
export type { PublicListing } from "./domain/public-listing";
export type { GetPublicListingResult } from "./public";
export type {
  GetListingForReviewResult,
  GetMyListingResult,
  ListingDocumentSummary,
  ListingForQueue,
  ListingForReview,
  ListListingsForReviewInput,
  ListListingsForReviewResult,
  MyListing,
  MyListingSummary,
} from "./queries";
export type { RegisterListingResult } from "./register";
export type {
  SearchedFrom,
  SearchListingsInput,
  SearchListingsResult,
  SearchResult,
} from "./search";
export { SEARCH_RESULT_LIMIT } from "./search";
export {
  DEFAULT_RADIUS_KM,
  RADIUS_OPTIONS_KM,
  type RadiusKm,
  type SearchField,
  type SearchFieldError,
} from "./domain/search-input";
export type { ApproximateDistance } from "./domain/geo";
export type {
  UpdateListingInput,
  UpdateListingResult,
  WithdrawListingInput,
  WithdrawListingResult,
} from "./update";
export {
  DIRECTORY_SERVICES,
  LISTING_TYPES,
  PUBLIC_CONTACT_FIELDS,
  type DirectoryService,
  type ListingType,
  type PublicContactField,
} from "./domain/catalogue";
export { DOCUMENT_KINDS, type DocumentKind } from "./domain/documents";
export { LISTING_FIELDS, LISTING_LIMITS } from "./domain/listing-input";
export {
  LISTING_STATUSES,
  STAFF_LISTING_ACTIONS,
  STATUS_REASON_MAX_LENGTH,
  type ListingStatus,
  type StaffListingAction,
} from "./domain/listing-status";
export { DIRECTORY_TAGS } from "./tags";

export const directoryUseCases = (ctx: UseCaseContext) => ({
  registerListing: (input: ListingDetailsInput) => registerListing(ctx, input),
  listMyListings: () => listMyListings(ctx),
  getMyListing: (input: { listingId: string }) => getMyListing(ctx, input),
  updateListing: (input: UpdateListingInput) => updateListing(ctx, input),
  withdrawListing: (input: WithdrawListingInput) => withdrawListing(ctx, input),
  requestListingDocumentUpload: (input: RequestListingDocumentUploadInput) =>
    requestListingDocumentUpload(ctx, input),
  listListingsForReview: (input: ListListingsForReviewInput = {}) =>
    listListingsForReview(ctx, input),
  getListingForReview: (input: { listingId: string }) =>
    getListingForReview(ctx, input),
  getListingDocumentUrl: (input: { documentId: string }) =>
    getListingDocumentUrl(ctx, input),
  verifyListing: (input: DecideListingInput) => verifyListing(ctx, input),
  rejectListing: (input: DecideListingInput) => rejectListing(ctx, input),
  suspendListing: (input: DecideListingInput) => suspendListing(ctx, input),
  reinstateListing: (input: DecideListingInput) => reinstateListing(ctx, input),
  getPublicListing: (input: { slug: string }) => getPublicListing(ctx, input),
  publicListingSlugs: () => publicListingSlugs(ctx),
  searchListings: (input: SearchListingsInput) => searchListings(ctx, input),
});
