// Applying to adopt an animal (#130).
//
//   adoptionApplicationForm({ slug })  → a signed-in user: the animal, the
//                                        consent text, whether a date of
//                                        birth is needed, any open application
//   applyToAdopt(input)                → a signed-in adult, for themselves
//
// Only adults adopt. The age comes from the date of birth on the
// applicant's participant profile when they have one (a teen's is the one
// their guardian entered, so a linked teen is always refused), or else the
// date they type, counted on India's calendar at the clock's instant. The
// consent to share their contact with the listing organisation is recorded
// in the same transaction as the application, so both commit or neither
// does. Loads under plain Node: relative imports only.

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import { adoptionApplication } from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { invalidInput, type InvalidInput } from "../../../input";
import { emit } from "../../../outbox";
import type { UseCaseContext } from "../../../use-cases";
import { lockUserSubject } from "../../consent/repository";
import { ageAt, parseDateOfBirth } from "../../participants/domain/age";
import { formatIsoDate } from "../../registration/domain/calendar-date";
import { applicantProfileOf } from "../../volunteers/application-record";
import {
  adopterAddressSchema,
  adopterPhoneSchema,
  adoptionAnswersSchema,
  type AdoptionAnswers,
} from "../domain/application-input";
import {
  decideNewAdoptionApplication,
  type NewAdoptionApplicationRefusal,
} from "../domain/application-eligibility";
import { OPEN_ADOPTION_APPLICATION_STATUSES } from "../domain/application-status";
import type { ConsentDocumentBody } from "../../consent/domain/document-body";
import {
  currentAdopterDocument,
  recordAdopterConsent,
  type AdopterConsentRefusal,
} from "./consents";
import {
  APPLICATION_PURPOSE,
  listingBySlug,
  representsListing,
} from "./record";

function signedInUser(ctx: UseCaseContext): string {
  // authorize() has already refused anyone else.
  if (ctx.actor.kind !== "user") throw new Error("Needs a signed-in user");
  return ctx.actor.userId;
}

async function openApplicationId(
  db: UseCaseContext["db"],
  listingId: string,
  userId: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: adoptionApplication.id })
    .from(adoptionApplication)
    .where(
      and(
        eq(adoptionApplication.adoptionListingId, listingId),
        eq(adoptionApplication.applicantUserId, userId),
        inArray(adoptionApplication.status, OPEN_ADOPTION_APPLICATION_STATUSES)
      )
    );
  return row?.id ?? null;
}

export type AdoptionApplicationForm =
  | {
      ok: true;
      animal: { slug: string; name: string; species: string };
      organisation: { name: string };
      /** The applicant must type their date of birth: no profile has one. */
      needsDateOfBirth: boolean;
      /** What applying agrees to; null until FOA publishes version 1. */
      contactSharingDocument: {
        id: string;
        version: number;
        title: string;
        body: ConsentDocumentBody;
      } | null;
      /** An open application to this animal, if the user has one. */
      openApplicationId: string | null;
    }
  | { ok: false; error: "listing_not_open" };

/** What the apply page shows; refuses an animal that isn't open. */
export async function adoptionApplicationForm(
  ctx: UseCaseContext,
  input: { slug: string }
): Promise<AdoptionApplicationForm> {
  await authorize(ctx, "adoption.application.apply");
  const userId = signedInUser(ctx);
  const slug = z.string().max(80).safeParse(input.slug);
  const listing = slug.success ? await listingBySlug(ctx.db, slug.data) : null;
  if (
    !listing ||
    listing.status !== "published" ||
    !listing.directoryVerified
  ) {
    return { ok: false, error: "listing_not_open" };
  }
  const profile = await applicantProfileOf(ctx.db, ctx.cipher, userId);
  return {
    ok: true,
    animal: {
      slug: listing.slug,
      name: listing.name,
      species: listing.species,
    },
    organisation: { name: listing.directoryName },
    needsDateOfBirth: profile === null,
    contactSharingDocument: await currentAdopterDocument(
      ctx.db,
      "adoption_contact_sharing"
    ),
    openApplicationId: await openApplicationId(ctx.db, listing.id, userId),
  };
}

export type ApplyToAdoptInput = {
  slug: string;
  phone: string;
  address: string;
  answers: AdoptionAnswers;
  /** `YYYY-MM-DD`, asked only of someone with no participant profile. */
  dateOfBirth?: string;
  /** The contact-sharing document the form showed. */
  contactSharingDocumentId: string;
};

export type ApplyToAdoptResult =
  | { ok: true; applicationId: string }
  | InvalidInput
  | {
      ok: false;
      error: NewAdoptionApplicationRefusal | AdopterConsentRefusal;
    };

const applyInput = z.object({
  slug: z.string().max(80),
  phone: adopterPhoneSchema,
  address: adopterAddressSchema,
  answers: adoptionAnswersSchema,
  dateOfBirth: z.string().optional(),
  contactSharingDocumentId: z.uuid(),
});

/** Applies for the signed-in user. Nothing is written when it's refused. */
export async function applyToAdopt(
  ctx: UseCaseContext,
  input: ApplyToAdoptInput
): Promise<ApplyToAdoptResult> {
  const { role: actorRole } = await authorize(
    ctx,
    "adoption.application.apply"
  );
  const userId = signedInUser(ctx);
  const parsed = applyInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { slug, phone, address, answers, dateOfBirth: typed } = parsed.data;
  const now = ctx.clock.now();
  const minAgeYears = await ctx.settings.get("adoption.minAdopterAgeYears");

  return ctx.db.transaction(async (tx) => {
    // Applying and giving consent take the user's row lock, so two
    // applications at once queue.
    await lockUserSubject(tx, userId);
    const listing = await listingBySlug(tx, slug, { share: true });
    if (!listing) return { ok: false, error: "listing_not_open" } as const;
    const profile = await applicantProfileOf(tx, ctx.cipher, userId);
    let dateOfBirth = profile?.dateOfBirth ?? null;
    if (!dateOfBirth && typed !== undefined && typed.trim() !== "") {
      dateOfBirth = parseDateOfBirth(typed.trim(), now);
      if (!dateOfBirth) {
        return {
          ok: false,
          error: "invalid_input",
          fields: ["dateOfBirth"],
        } as const;
      }
    }
    const decision = decideNewAdoptionApplication({
      listing: {
        status: listing.status,
        directoryVerified: listing.directoryVerified,
      },
      applicantRepresentsListing: await representsListing(
        tx,
        userId,
        listing.directoryListingId
      ),
      applicantAgeYears: dateOfBirth ? ageAt(dateOfBirth, now) : null,
      minAgeYears,
      hasOpenApplication:
        (await openApplicationId(tx, listing.id, userId)) !== null,
    });
    if (!decision.ok) return { ok: false, error: decision.reason } as const;
    // decideNewAdoptionApplication refuses an unknown date of birth.
    const born = dateOfBirth!;

    const consent = await recordAdopterConsent(
      tx,
      ctx,
      userId,
      "adoption_contact_sharing",
      parsed.data.contactSharingDocumentId
    );
    if (!consent.ok) return consent;

    const id = uuidv7(now);
    await tx.insert(adoptionApplication).values({
      id,
      adoptionListingId: listing.id,
      applicantUserId: userId,
      participantProfileId: profile?.id ?? null,
      dateOfBirthCiphertext: ctx.cipher.encrypt(
        APPLICATION_PURPOSE.dob,
        formatIsoDate(born)
      ),
      phoneCiphertext: ctx.cipher.encrypt(APPLICATION_PURPOSE.phone, phone),
      addressCiphertext: ctx.cipher.encrypt(
        APPLICATION_PURPOSE.address,
        address
      ),
      answersCiphertext: ctx.cipher.encrypt(
        APPLICATION_PURPOSE.answers,
        JSON.stringify(answers)
      ),
      contactSharingConsentId: consent.consentEventId,
      status: decision.status,
      createdAt: now,
      updatedAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "adoption.application_submitted",
      entity: { type: "adoption_application", id },
      before: null,
      after: {
        status: decision.status,
        adoptionListingId: listing.id,
        contactSharingConsentId: consent.consentEventId,
      },
      actorRole,
    });
    await emit(tx, ctx.clock, {
      type: "adoption.application_submitted",
      aggregate: { type: "adoption_application", id },
      payload: { applicationId: id },
    });
    return { ok: true, applicationId: id } as const;
  });
}
