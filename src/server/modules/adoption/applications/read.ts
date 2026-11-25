// Reading adoption applications (#130):
//
//   myAdoptionApplications()                  → the applicant's own, newest first
//   myAdoptionApplication({ applicationId })  → one of them, with its story
//   listAdoptionApplications({ status? })     → the coordinator's queue
//   getAdoptionApplication({ applicationId }) → the coordinator's view
//   listApplicationsForAdoptionListing(...)   → the listing organisation's view
//
// The organisation sees each application's status and dates; the
// applicant's name, phone, address and answers only from `in_contact` on.
// Loads under plain Node.

import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import type { AppDb } from "../../../db/app-db";
import {
  adoptionApplication,
  adoptionListing,
  adoptionStory,
  directoryListing,
  user,
} from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import type { ConsentDocumentBody } from "../../consent/domain/document-body";
import { adoptionListingManaged } from "../acting-for";
import {
  ADOPTION_APPLICATION_STATUSES,
  OPEN_ADOPTION_APPLICATION_STATUSES,
  ownerSeesApplicantContact,
  type AdoptionApplicationStatus,
} from "../domain/application-status";
import type { AdoptionStoryStatus } from "../domain/success-story";
import { adopterConsentGiven, currentAdopterDocument } from "./consents";
import {
  APPLICATION_PURPOSE,
  applicationWithListing,
  coordinatorScope,
  decryptDetails,
  organisationScope,
  refused,
  type ApplicantDetails,
} from "./record";

/** One application as its lists show it. */
export type AdoptionApplicationSummary = {
  id: string;
  status: AdoptionApplicationStatus;
  createdAt: Date;
  updatedAt: Date;
  animal: { slug: string; name: string; species: string };
  organisation: { name: string };
};

export type AdoptionStoryView = {
  id: string;
  status: AdoptionStoryStatus;
  body: string;
  publishedAt: Date | null;
};

const summaryColumns = {
  id: adoptionApplication.id,
  status: adoptionApplication.status,
  createdAt: adoptionApplication.createdAt,
  updatedAt: adoptionApplication.updatedAt,
  animalSlug: adoptionListing.slug,
  animalName: adoptionListing.name,
  animalSpecies: adoptionListing.species,
  organisationName: directoryListing.name,
};

type SummaryRow = {
  id: string;
  status: AdoptionApplicationStatus;
  createdAt: Date;
  updatedAt: Date;
  animalSlug: string;
  animalName: string;
  animalSpecies: string;
  organisationName: string;
};

function summaryOf(row: SummaryRow): AdoptionApplicationSummary {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    animal: {
      slug: row.animalSlug,
      name: row.animalName,
      species: row.animalSpecies,
    },
    organisation: { name: row.organisationName },
  };
}

function summaries(db: AppDb, where: SQL | undefined) {
  return db
    .select(summaryColumns)
    .from(adoptionApplication)
    .innerJoin(
      adoptionListing,
      eq(adoptionListing.id, adoptionApplication.adoptionListingId)
    )
    .innerJoin(
      directoryListing,
      eq(directoryListing.id, adoptionListing.directoryListingId)
    )
    .where(where);
}

async function storyOf(
  db: AppDb,
  applicationId: string
): Promise<AdoptionStoryView | null> {
  const [row] = await db
    .select({
      id: adoptionStory.id,
      status: adoptionStory.status,
      body: adoptionStory.body,
      publishedAt: adoptionStory.publishedAt,
    })
    .from(adoptionStory)
    .where(eq(adoptionStory.applicationId, applicationId));
  return row ?? null;
}

/** The signed-in user's applications, newest first. */
export async function myAdoptionApplications(
  ctx: UseCaseContext
): Promise<AdoptionApplicationSummary[]> {
  await authorize(ctx, "adoption.application.apply");
  if (ctx.actor.kind !== "user") return [];
  const rows = await summaries(
    ctx.db,
    eq(adoptionApplication.applicantUserId, ctx.actor.userId)
  ).orderBy(desc(adoptionApplication.createdAt), desc(adoptionApplication.id));
  return rows.map(summaryOf);
}

export type MyAdoptionApplication = AdoptionApplicationSummary & {
  details: ApplicantDetails;
  story: AdoptionStoryView | null;
  /** The adopter may write a success story now. */
  canWriteStory: boolean;
  /** Their consent to share stories stands. */
  storyConsentGiven: boolean;
  /** What writing a story agrees to; null until FOA publishes version 1. */
  storyConsentDocument: {
    id: string;
    version: number;
    title: string;
    body: ConsentDocumentBody;
  } | null;
};

const idInput = z.object({ applicationId: z.uuid() });

/** One of the signed-in user's applications; refused for anyone else's. */
export async function myAdoptionApplication(
  ctx: UseCaseContext,
  input: { applicationId: string }
): Promise<MyAdoptionApplication | InvalidInput> {
  const parsed = idInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const found = await applicationWithListing(ctx.db, parsed.data.applicationId);
  if (!found) refused(ctx, "adoption.application.view_own");
  await authorize(ctx, "adoption.application.view_own", {
    ownerId: found.application.applicantUserId,
  });
  const { application, listing, directory } = found;
  const story = await storyOf(ctx.db, application.id);
  const adopted = application.status === "adopted";
  return {
    id: application.id,
    status: application.status,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    animal: {
      slug: listing.slug,
      name: listing.name,
      species: listing.species,
    },
    organisation: { name: directory.name },
    details: decryptDetails(ctx.cipher, application),
    story,
    canWriteStory: adopted && story === null,
    storyConsentGiven: await adopterConsentGiven(
      ctx.db,
      application.applicantUserId,
      "adoption_success_story"
    ),
    storyConsentDocument:
      adopted && story === null
        ? await currentAdopterDocument(ctx.db, "adoption_success_story")
        : null,
  };
}

export type CoordinatorApplicationSummary = AdoptionApplicationSummary & {
  applicant: { name: string };
};

const listInput = z.object({
  status: z.enum(["open", ...ADOPTION_APPLICATION_STATUSES]).default("open"),
});

/**
 * The coordinator's queue, oldest first: open applications by default, or
 * one status. An organisation-scoped coordinator sees only theirs.
 */
export async function listAdoptionApplications(
  ctx: UseCaseContext,
  input: { status?: string } = {}
): Promise<CoordinatorApplicationSummary[] | InvalidInput> {
  const { organisations } = await coordinatorScope(
    ctx,
    "adoption.application.review"
  );
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const status = parsed.data.status;
  const rows = await ctx.db
    .select({ ...summaryColumns, applicantName: user.name })
    .from(adoptionApplication)
    .innerJoin(
      adoptionListing,
      eq(adoptionListing.id, adoptionApplication.adoptionListingId)
    )
    .innerJoin(
      directoryListing,
      eq(directoryListing.id, adoptionListing.directoryListingId)
    )
    .innerJoin(user, eq(user.id, adoptionApplication.applicantUserId))
    .where(
      and(
        status === "open"
          ? inArray(
              adoptionApplication.status,
              OPEN_ADOPTION_APPLICATION_STATUSES
            )
          : eq(adoptionApplication.status, status),
        // coordinatorScope refused anyone holding no grant at all.
        organisations === "all"
          ? undefined
          : inArray(adoptionListing.directoryListingId, organisations)
      )
    )
    .orderBy(asc(adoptionApplication.createdAt), asc(adoptionApplication.id));
  return rows.map((row) => ({
    ...summaryOf(row),
    applicant: { name: row.applicantName },
  }));
}

export type CoordinatorApplicationView = CoordinatorApplicationSummary & {
  applicant: { name: string; email: string | null };
  details: ApplicantDetails;
  /** `YYYY-MM-DD`, as the adult-only rule counted it. */
  dateOfBirth: string;
  contactSharedAt: Date | null;
  /** Why it ended not matched or declined; staff only. */
  outcomeReason: string | null;
  story: AdoptionStoryView | null;
  storyConsentGiven: boolean;
};

/** One application, in full, for a coordinator who may see it. */
export async function getAdoptionApplication(
  ctx: UseCaseContext,
  input: { applicationId: string }
): Promise<CoordinatorApplicationView | InvalidInput> {
  const parsed = idInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const found = await applicationWithListing(ctx.db, parsed.data.applicationId);
  if (!found) refused(ctx, "adoption.application.review");
  await authorize(
    ctx,
    "adoption.application.review",
    organisationScope(found.listing.directoryListingId)
  );
  const { application, listing, directory } = found;
  const [applicant] = await ctx.db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, application.applicantUserId));
  return {
    id: application.id,
    status: application.status,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    animal: {
      slug: listing.slug,
      name: listing.name,
      species: listing.species,
    },
    organisation: { name: directory.name },
    applicant: { name: applicant!.name, email: applicant!.email },
    details: decryptDetails(ctx.cipher, application),
    dateOfBirth: ctx.cipher.decrypt(
      APPLICATION_PURPOSE.dob,
      application.dateOfBirthCiphertext
    ),
    contactSharedAt: application.contactSharedAt,
    outcomeReason:
      application.outcomeReasonCiphertext === null
        ? null
        : ctx.cipher.decrypt(
            APPLICATION_PURPOSE.outcomeReason,
            application.outcomeReasonCiphertext
          ),
    story: await storyOf(ctx.db, application.id),
    storyConsentGiven: await adopterConsentGiven(
      ctx.db,
      application.applicantUserId,
      "adoption_success_story"
    ),
  };
}

/** One application as the listing organisation sees it. */
export type OwnerApplicationView = {
  id: string;
  status: AdoptionApplicationStatus;
  createdAt: Date;
  updatedAt: Date;
  /** Only once the coordinator has put them in touch. */
  applicant: ({ name: string } & ApplicantDetails) | null;
};

export type ListApplicationsForAdoptionListingResult =
  | {
      ok: true;
      animal: { id: string; name: string };
      applications: OwnerApplicationView[];
    }
  | InvalidInput;

const listingInput = z.object({ adoptionListingId: z.uuid() });

/** An animal's applications, for its organisation's representatives. */
export async function listApplicationsForAdoptionListing(
  ctx: UseCaseContext,
  input: { adoptionListingId: string }
): Promise<ListApplicationsForAdoptionListingResult> {
  const parsed = listingInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  // The representative's own check first: refuses staff and strangers.
  const { row } = await adoptionListingManaged(
    ctx,
    ctx.db,
    parsed.data.adoptionListingId
  );
  await authorize(
    ctx,
    "adoption.application.owner_read",
    organisationScope(row.directoryListingId)
  );
  const rows = await ctx.db
    .select({ application: adoptionApplication, applicantName: user.name })
    .from(adoptionApplication)
    .innerJoin(user, eq(user.id, adoptionApplication.applicantUserId))
    .where(eq(adoptionApplication.adoptionListingId, row.id))
    .orderBy(desc(adoptionApplication.createdAt), desc(adoptionApplication.id));
  return {
    ok: true,
    animal: { id: row.id, name: row.name },
    applications: rows.map(({ application, applicantName }) => ({
      id: application.id,
      status: application.status,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
      applicant: ownerSeesApplicantContact(application.status)
        ? { name: applicantName, ...decryptDetails(ctx.cipher, application) }
        : null,
    })),
  };
}
