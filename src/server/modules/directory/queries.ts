// Reading listings (#127).
//
//   listMyListings()                     → the listings the signed-in user acts for
//   getMyListing({ listingId })          → one of them in full, with its documents
//   listListingsForReview({ status? })   → FOA admins' queue, oldest first, in pages
//   getListingForReview({ listingId })   → every detail, for FOA admins

import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import type { AppDb } from "../../db/app-db";
import {
  directoryListing,
  directoryListingDocument,
  fileAsset,
  user,
  userRole,
} from "../../db/schema";
import { signedInUser } from "../../identity/account";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import type { FileStatus } from "../files/domain/file-status";
import { listingActedFor } from "./acting-for";
import type { ListingType } from "./domain/catalogue";
import {
  documentChecklist,
  type ChecklistItem,
  type DocumentKind,
} from "./domain/documents";
import {
  allowedStaffActions,
  canEdit,
  canWithdraw,
  LISTING_STATUSES,
  type ListingStatus,
  type StaffListingAction,
} from "./domain/listing-status";
import type { StoredListing } from "./domain/public-listing";
import { storedListingOf } from "./stored-listing";

/** Statuses in which a listing's people may add documents. */
const TAKES_DOCUMENTS: ReadonlySet<ListingStatus> = new Set([
  "pending_verification",
  "verified",
  "suspended",
]);

export function takesDocuments(status: ListingStatus): boolean {
  return TAKES_DOCUMENTS.has(status);
}

/** One line of "your listings". */
export type MyListingSummary = {
  id: string;
  slug: string;
  name: string;
  type: ListingType;
  status: ListingStatus;
  statusReason: string | null;
  statusChangedAt: Date;
  canEdit: boolean;
  canWithdraw: boolean;
};

/**
 * The listings the signed-in user acts for: those they registered that FOA
 * hasn't verified yet (pending, rejected or withdrawn before verification),
 * and those they represent. Newest first.
 */
export async function listMyListings(
  ctx: UseCaseContext
): Promise<MyListingSummary[]> {
  await authorize(ctx, "directory.view_own");
  const { userId } = signedInUser(ctx);
  const represented = ctx.db
    .select({ id: userRole.scopeId })
    .from(userRole)
    .where(
      and(
        eq(userRole.userId, userId),
        eq(userRole.role, "organisation_representative"),
        eq(userRole.scopeType, "organisation")
      )
    );
  const rows = await ctx.db
    .select({
      id: directoryListing.id,
      slug: directoryListing.slug,
      name: directoryListing.name,
      type: directoryListing.type,
      status: directoryListing.status,
      statusReason: directoryListing.statusReason,
      statusChangedAt: directoryListing.statusChangedAt,
    })
    .from(directoryListing)
    .where(
      or(
        and(
          eq(directoryListing.ownerUserId, userId),
          isNull(directoryListing.verifiedAt)
        ),
        inArray(directoryListing.id, represented)
      )
    )
    .orderBy(desc(directoryListing.createdAt), desc(directoryListing.id));
  return rows.map((row) => ({
    ...row,
    canEdit: canEdit(row.status),
    canWithdraw: canWithdraw(row.status),
  }));
}

/** A document as the listing's people and staff see it: never its bytes. */
export type ListingDocumentSummary = {
  id: string;
  kind: DocumentKind;
  /** The file's scan status: `uploaded` and `scanning` are still checking. */
  fileStatus: FileStatus;
  uploadedAt: Date;
};

/** The listing's documents, oldest first; abandoned uploads left out. */
async function documentsOf(
  db: AppDb,
  listingId: string
): Promise<ListingDocumentSummary[]> {
  return db
    .select({
      id: directoryListingDocument.id,
      kind: directoryListingDocument.kind,
      fileStatus: fileAsset.status,
      uploadedAt: directoryListingDocument.createdAt,
    })
    .from(directoryListingDocument)
    .innerJoin(fileAsset, eq(fileAsset.id, directoryListingDocument.fileAssetId))
    .where(
      and(
        eq(directoryListingDocument.listingId, listingId),
        ne(fileAsset.status, "pending_upload"),
        ne(fileAsset.status, "deleted")
      )
    )
    .orderBy(
      asc(directoryListingDocument.createdAt),
      asc(directoryListingDocument.id)
    );
}

export type MyListing = StoredListing & {
  statusChangedAt: Date;
  registeredAt: Date;
  verifiedAt: Date | null;
  documents: ListingDocumentSummary[];
  canEdit: boolean;
  canWithdraw: boolean;
  canAddDocuments: boolean;
};

export type GetMyListingResult = { ok: true; listing: MyListing } | InvalidInput;

const listingIdInput = z.object({ listingId: z.uuid() });

/** One listing the actor acts for, decrypted, with its documents. */
export async function getMyListing(
  ctx: UseCaseContext,
  input: { listingId: string }
): Promise<GetMyListingResult> {
  const parsed = listingIdInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { row } = await listingActedFor(ctx, ctx.db, parsed.data.listingId);
  return {
    ok: true,
    listing: {
      ...storedListingOf(ctx, row),
      statusChangedAt: row.statusChangedAt,
      registeredAt: row.createdAt,
      verifiedAt: row.verifiedAt,
      documents: await documentsOf(ctx.db, row.id),
      canEdit: canEdit(row.status),
      canWithdraw: canWithdraw(row.status),
      canAddDocuments: takesDocuments(row.status),
    },
  };
}

/** At most this many listings per page of the staff queue. */
export const REVIEW_PAGE_SIZE = 50;

/** One line of the staff queue. */
export type ListingForQueue = {
  id: string;
  name: string;
  type: ListingType;
  city: string;
  state: string;
  status: ListingStatus;
  registeredAt: Date;
};

export type ListListingsForReviewInput = {
  status?: ListingStatus;
  /** The last listing of the page before; the next page starts after it. */
  after?: string;
};

export type ListListingsForReviewResult =
  | { ok: true; listings: ListingForQueue[]; next: string | null }
  | InvalidInput;

const listForReviewInput = z.object({
  status: z.enum(LISTING_STATUSES).default("pending_verification"),
  after: z.uuid().optional(),
});

/**
 * Listings in one status (pending verification unless told), oldest
 * registration first, one page at a time.
 */
export async function listListingsForReview(
  ctx: UseCaseContext,
  input: ListListingsForReviewInput
): Promise<ListListingsForReviewResult> {
  await authorize(ctx, "directory.review");
  const parsed = listForReviewInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { status, after } = parsed.data;
  const rows = await ctx.db
    .select({
      id: directoryListing.id,
      name: directoryListing.name,
      type: directoryListing.type,
      city: directoryListing.city,
      state: directoryListing.state,
      status: directoryListing.status,
      registeredAt: directoryListing.createdAt,
    })
    .from(directoryListing)
    .where(
      and(
        eq(directoryListing.status, status),
        after === undefined
          ? undefined
          : sql`(${directoryListing.createdAt}, ${directoryListing.id}) > (
              SELECT ${directoryListing.createdAt}, ${directoryListing.id}
              FROM ${directoryListing} WHERE ${directoryListing.id} = ${after}
            )`
      )
    )
    .orderBy(asc(directoryListing.createdAt), asc(directoryListing.id))
    .limit(REVIEW_PAGE_SIZE + 1);
  const listings = rows.slice(0, REVIEW_PAGE_SIZE);
  return {
    ok: true,
    listings,
    next:
      rows.length > REVIEW_PAGE_SIZE ? (listings.at(-1)?.id ?? null) : null,
  };
}

/** Everything staff need to decide, including who registered it. */
export type ListingForReview = MyListing & {
  owner: { id: string; name: string; email: string | null };
  checklist: ChecklistItem[];
  allowedActions: StaffListingAction[];
};

export type GetListingForReviewResult =
  | { ok: true; listing: ListingForReview }
  | InvalidInput
  | { ok: false; error: "not_found" };

export async function getListingForReview(
  ctx: UseCaseContext,
  input: { listingId: string }
): Promise<GetListingForReviewResult> {
  await authorize(ctx, "directory.review");
  const parsed = listingIdInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const [found] = await ctx.db
    .select({
      row: directoryListing,
      owner: { id: user.id, name: user.name, email: user.email },
    })
    .from(directoryListing)
    .innerJoin(user, eq(user.id, directoryListing.ownerUserId))
    .where(eq(directoryListing.id, parsed.data.listingId));
  if (!found) return { ok: false, error: "not_found" };
  const { row } = found;
  const documents = await documentsOf(ctx.db, row.id);
  return {
    ok: true,
    listing: {
      ...storedListingOf(ctx, row),
      statusChangedAt: row.statusChangedAt,
      registeredAt: row.createdAt,
      verifiedAt: row.verifiedAt,
      documents,
      canEdit: canEdit(row.status),
      canWithdraw: canWithdraw(row.status),
      canAddDocuments: takesDocuments(row.status),
      owner: found.owner,
      checklist: documentChecklist(
        row.type,
        documents.map((document) => document.kind)
      ),
      allowedActions: allowedStaffActions(row.status),
    },
  };
}
