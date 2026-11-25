// Success stories (#130). After an adoption the adopter may tell how their
// animal settled in; FOA shares it on /adopt/stories only while they
// consent (purpose adoption_success_story):
//
//   submitSuccessStory({ applicationId, body, consentDocumentId })
//       → the adopter of an adopted application: gives consent, saves a draft
//   publishSuccessStory({ applicationId })
//       → the coordinator: needs the adopter's consent to stand
//   withdrawSuccessStoryConsent({ applicationId })
//       → the adopter: withdraws consent; every story of theirs is
//         withdrawn in the same transaction, so none stays public
//   listPublishedSuccessStories()
//       → anyone: the animal's name and species, the organisation and the
//         story; never the adopter's name or contact
//
// Loads under plain Node.

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import {
  adoptionApplication,
  adoptionListing,
  adoptionStory,
  directoryListing,
} from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import { isPubliclyListed } from "../../directory/domain/listing-status";
import type { AdoptionSpecies } from "../domain/details";
import { lockUserSubject } from "../../consent/repository";
import {
  decideStoryPublication,
  storyTextSchema,
  type StoryTransitionRefusal,
} from "../domain/success-story";
import {
  adopterConsentGiven,
  recordAdopterConsent,
  withdrawStoryConsent,
  type AdopterConsentRefusal,
} from "./consents";
import { applicationWithListing, organisationScope, refused } from "./record";

export type SubmitSuccessStoryResult =
  | { ok: true; storyId: string }
  | InvalidInput
  | {
      ok: false;
      error: "not_adopted" | "story_exists" | AdopterConsentRefusal;
    };

const submitInput = z.object({
  applicationId: z.uuid(),
  body: storyTextSchema,
  consentDocumentId: z.uuid(),
});

export async function submitSuccessStory(
  ctx: UseCaseContext,
  input: { applicationId: string; body: string; consentDocumentId: string }
): Promise<SubmitSuccessStoryResult> {
  const parsed = submitInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (tx) => {
    const found = await applicationWithListing(tx, parsed.data.applicationId, {
      lock: true,
    });
    if (!found) refused(ctx, "adoption.story.submit");
    const userId = found.application.applicantUserId;
    const { role } = await authorize(
      { ...ctx, db: tx },
      "adoption.story.submit",
      {
        ownerId: userId,
      }
    );
    if (found.application.status !== "adopted") {
      return { ok: false, error: "not_adopted" } as const;
    }
    const [existing] = await tx
      .select({ id: adoptionStory.id })
      .from(adoptionStory)
      .where(eq(adoptionStory.applicationId, found.application.id));
    if (existing) return { ok: false, error: "story_exists" } as const;
    await lockUserSubject(tx, userId);
    const consent = await recordAdopterConsent(
      tx,
      ctx,
      userId,
      "adoption_success_story",
      parsed.data.consentDocumentId
    );
    if (!consent.ok) return consent;
    const now = ctx.clock.now();
    const id = uuidv7(now);
    await tx.insert(adoptionStory).values({
      id,
      applicationId: found.application.id,
      body: parsed.data.body,
      status: "draft",
      consentEventId: consent.consentEventId,
      createdAt: now,
      updatedAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "adoption.story_submitted",
      entity: { type: "adoption_story", id },
      before: null,
      after: {
        status: "draft",
        applicationId: found.application.id,
        consentEventId: consent.consentEventId,
      },
      actorRole: role,
    });
    return { ok: true, storyId: id } as const;
  });
}

export type PublishSuccessStoryResult =
  | { ok: true }
  | InvalidInput
  | { ok: false; error: "no_story" | StoryTransitionRefusal };

const applicationInput = z.object({ applicationId: z.uuid() });

export async function publishSuccessStory(
  ctx: UseCaseContext,
  input: { applicationId: string }
): Promise<PublishSuccessStoryResult> {
  const parsed = applicationInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (tx) => {
    const found = await applicationWithListing(tx, parsed.data.applicationId);
    if (!found) refused(ctx, "adoption.story.publish");
    const { role } = await authorize(
      { ...ctx, db: tx },
      "adoption.story.publish",
      organisationScope(found.listing.directoryListingId)
    );
    const userId = found.application.applicantUserId;
    // A withdrawal at the same moment waits for this, or this for it.
    await lockUserSubject(tx, userId);
    const [story] = await tx
      .select({ id: adoptionStory.id, status: adoptionStory.status })
      .from(adoptionStory)
      .where(eq(adoptionStory.applicationId, found.application.id))
      .for("update");
    if (!story) return { ok: false, error: "no_story" } as const;
    const decision = decideStoryPublication({
      status: story.status,
      consentGiven: await adopterConsentGiven(
        tx,
        userId,
        "adoption_success_story"
      ),
    });
    if (!decision.ok) return { ok: false, error: decision.reason } as const;
    const now = ctx.clock.now();
    await tx
      .update(adoptionStory)
      .set({
        status: "published",
        publishedAt: now,
        publishedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        updatedAt: now,
      })
      .where(eq(adoptionStory.id, story.id));
    await recordAudit(tx, ctx, {
      action: "adoption.story_published",
      entity: { type: "adoption_story", id: story.id },
      before: { status: story.status },
      after: { status: "published" },
      actorRole: role,
    });
    return { ok: true } as const;
  });
}

export type WithdrawSuccessStoryConsentResult =
  | { ok: true; withdrawnStories: number }
  | InvalidInput;

/**
 * The adopter withdraws their consent to share success stories: the
 * consent event and every story of theirs going `withdrawn` commit
 * together, so no public read shows one after.
 */
export async function withdrawSuccessStoryConsent(
  ctx: UseCaseContext,
  input: { applicationId: string }
): Promise<WithdrawSuccessStoryConsentResult> {
  const parsed = applicationInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (tx) => {
    const found = await applicationWithListing(tx, parsed.data.applicationId);
    if (!found) refused(ctx, "adoption.story.withdraw");
    const userId = found.application.applicantUserId;
    const { role } = await authorize(
      { ...ctx, db: tx },
      "adoption.story.withdraw",
      { ownerId: userId }
    );
    await lockUserSubject(tx, userId);
    await withdrawStoryConsent(tx, ctx, userId);
    const stories = await tx
      .select({ id: adoptionStory.id, status: adoptionStory.status })
      .from(adoptionStory)
      .innerJoin(
        adoptionApplication,
        eq(adoptionApplication.id, adoptionStory.applicationId)
      )
      .where(
        and(
          eq(adoptionApplication.applicantUserId, userId),
          inArray(adoptionStory.status, ["draft", "published"])
        )
      )
      .for("update", { of: adoptionStory });
    const now = ctx.clock.now();
    for (const story of stories) {
      await tx
        .update(adoptionStory)
        .set({ status: "withdrawn", withdrawnAt: now, updatedAt: now })
        .where(eq(adoptionStory.id, story.id));
      await recordAudit(tx, ctx, {
        action: "adoption.story_withdrawn",
        entity: { type: "adoption_story", id: story.id },
        before: { status: story.status },
        after: { status: "withdrawn" },
        actorRole: role,
      });
    }
    return { ok: true, withdrawnStories: stories.length } as const;
  });
}

/** A story as the public reads it: no adopter's name, no contact. */
export type PublishedSuccessStory = {
  id: string;
  body: string;
  publishedAt: Date;
  animal: { name: string; species: AdoptionSpecies };
  organisation: { name: string; slug: string };
};

/** Published stories, newest first, of organisations still listed. */
export async function listPublishedSuccessStories(
  ctx: UseCaseContext
): Promise<PublishedSuccessStory[]> {
  await authorize(ctx, "adoption.story.read_public");
  const rows = await ctx.db
    .select({
      id: adoptionStory.id,
      body: adoptionStory.body,
      publishedAt: adoptionStory.publishedAt,
      animalName: adoptionListing.name,
      animalSpecies: adoptionListing.species,
      organisationName: directoryListing.name,
      organisationSlug: directoryListing.slug,
      organisationStatus: directoryListing.status,
    })
    .from(adoptionStory)
    .innerJoin(
      adoptionApplication,
      eq(adoptionApplication.id, adoptionStory.applicationId)
    )
    .innerJoin(
      adoptionListing,
      eq(adoptionListing.id, adoptionApplication.adoptionListingId)
    )
    .innerJoin(
      directoryListing,
      eq(directoryListing.id, adoptionListing.directoryListingId)
    )
    .where(eq(adoptionStory.status, "published"))
    .orderBy(desc(adoptionStory.publishedAt), desc(adoptionStory.id))
    .limit(60);
  return rows
    .filter((row) => isPubliclyListed(row.organisationStatus))
    .map((row) => ({
      id: row.id,
      body: row.body,
      publishedAt: row.publishedAt!,
      animal: { name: row.animalName, species: row.animalSpecies },
      organisation: { name: row.organisationName, slug: row.organisationSlug },
    }));
}
