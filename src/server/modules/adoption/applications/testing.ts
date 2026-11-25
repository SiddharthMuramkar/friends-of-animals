// Test helpers for adoption applications (#130): the consent documents
// published, a published animal under a verified organisation, an adult
// applicant, a coordinator who passed their second factor, and readers for
// the rows a compliance rule cares about. Tests only: nothing in the app
// imports this file.

import { and, asc, eq, like } from "drizzle-orm";

import type { Actor } from "@/server/actor";
import {
  adoptionApplication,
  auditLog,
  inboxItem,
  outbox,
} from "@/server/db/schema";
import { parseConsentDocumentBody } from "@/server/modules/consent/domain/document-body";
import type { AdoptionPurpose } from "@/server/modules/consent/domain/purposes";
import { insertConsentDocumentVersion } from "@/server/modules/consent/insert-version";
import { formatIsoDate } from "@/server/modules/registration/domain/calendar-date";
import { bornYearsAgo as birthDateYearsAgo } from "@/server/seed/guardians";
import type { Harness } from "@/test/harness";

import { published, representative } from "../testing";
import type { ApplyToAdoptInput } from "./apply";

/** Publishes the next version of an adopter's consent document. */
export async function publishAdopterDocument(
  h: Harness,
  purpose: AdoptionPurpose
): Promise<string> {
  const parsed = parseConsentDocumentBody({
    short: [[`Draft ${purpose}.`]],
    sections: [
      {
        id: "what-you-agree",
        title: "What you agree to",
        blocks: [{ p: [`Draft ${purpose} text. Not FOA's words.`] }],
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.issues.join("; "));
  const { id } = await h.db.transaction((tx) =>
    insertConsentDocumentVersion(
      tx,
      { now: h.clock.now(), publishedByUserId: null },
      { purpose, title: null, body: parsed.body, legalRevisionId: null }
    )
  );
  return id;
}

export type AdopterDocuments = { contactSharing: string; story: string };

export async function publishAdopterDocuments(
  h: Harness
): Promise<AdopterDocuments> {
  return {
    contactSharing: await publishAdopterDocument(h, "adoption_contact_sharing"),
    story: await publishAdopterDocument(h, "adoption_success_story"),
  };
}

/** `YYYY-MM-DD` of someone `years` old today in India. */
export function bornYearsAgo(h: Harness, years: number, days = 0): string {
  return formatIsoDate(birthDateYearsAgo(h.clock.now(), years, days));
}

/** What an adult with no profile sends when they apply. */
export function applyInput(
  h: Harness,
  slug: string,
  documents: AdopterDocuments,
  overrides: Partial<ApplyToAdoptInput> = {}
): ApplyToAdoptInput {
  return {
    slug,
    phone: "98765 43210",
    address: "Flat 4, Sunrise Apartments, Koregaon Park, Pune 411001",
    answers: {
      homeType: "flat",
      hasOutdoorSpace: false,
      otherAnimals: "",
      experience: "Grew up with two dogs.",
      whyThisAnimal: "A calm dog suits our flat and our quiet days.",
    },
    dateOfBirth: bornYearsAgo(h, 30),
    contactSharingDocumentId: documents.contactSharing,
    ...overrides,
  };
}

/**
 * The adoption world: the consent documents, a verified organisation with
 * its representative and a published animal (Bruno), and an adult member.
 */
export async function adoptionWorld(h: Harness) {
  const documents = await publishAdopterDocuments(h);
  const rep = await representative(h, "verified", { name: "Paws Pune" });
  const animal = await published(h, rep);
  const applicantAccount = await h.seed.member({
    name: "Meera Iyer",
    email: "meera@example.test",
  });
  const applicant = {
    id: applicantAccount.id,
    actor: await h.signIn(applicantAccount),
  };
  return { documents, rep, animal, applicant };
}

export type AdoptionWorld = Awaited<ReturnType<typeof adoptionWorld>>;

/** An application by the world's applicant, as submitted. */
export async function applied(
  h: Harness,
  world: AdoptionWorld,
  applicant: { actor: Actor } = world.applicant,
  overrides: Partial<ApplyToAdoptInput> = {}
): Promise<string> {
  const result = await h
    .as(applicant.actor)
    .applyToAdopt(applyInput(h, world.animal.slug, world.documents, overrides));
  if (!result.ok) throw new Error(`Applying failed: ${result.error}`);
  return result.applicationId;
}

/** A signed-in adoption coordinator, global unless scoped to a listing. */
export async function coordinator(
  h: Harness,
  scope: { type: "global" } | { type: "organisation"; id: string } = {
    type: "global",
  }
): Promise<Actor> {
  const account = await h.seed.member();
  await h.seed.grant(account, { role: "adoption_coordinator", scope });
  return h.signIn(account);
}

/** Moves an application to in_contact. */
export async function inContact(
  h: Harness,
  coordinatorActor: Actor,
  applicationId: string
) {
  const review = await h
    .as(coordinatorActor)
    .startAdoptionReview({ applicationId });
  if (!review.ok) throw new Error(`Review failed: ${review.error}`);
  const contact = await h
    .as(coordinatorActor)
    .putAdopterInContact({ applicationId });
  if (!contact.ok) throw new Error(`Contact failed: ${contact.error}`);
}

/** Moves an application to adopted. */
export async function adopted(
  h: Harness,
  coordinatorActor: Actor,
  applicationId: string
) {
  await inContact(h, coordinatorActor, applicationId);
  const outcome = await h
    .as(coordinatorActor)
    .recordAdoptionOutcome({ applicationId, outcome: "adopted" });
  if (!outcome.ok) throw new Error(`Outcome failed: ${outcome.error}`);
}

export async function applicationRow(h: Harness, id: string) {
  const [row] = await h.db
    .select()
    .from(adoptionApplication)
    .where(eq(adoptionApplication.id, id));
  return row;
}

/** The adoption application audit entries, in the order written. */
export async function applicationAudit(h: Harness, applicationId: string) {
  return h.db
    .select({
      action: auditLog.action,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .where(
      and(
        like(auditLog.action, "adoption.%"),
        eq(auditLog.entityId, applicationId)
      )
    )
    .orderBy(asc(auditLog.id));
}

/** The adoption events queued in the outbox, by type. */
export async function adoptionEvents(h: Harness) {
  return h.db
    .select({ type: outbox.eventType, payload: outbox.payload })
    .from(outbox)
    .where(like(outbox.eventType, "adoption.%"))
    .orderBy(asc(outbox.occurredAt), asc(outbox.eventType));
}

/** The templates of a user's inbox items, oldest first. */
export async function inboxTemplates(h: Harness, userId: string) {
  const rows = await h.db
    .select({ key: inboxItem.templateKey })
    .from(inboxItem)
    .where(eq(inboxItem.userId, userId))
    .orderBy(asc(inboxItem.createdAt), asc(inboxItem.id));
  return rows.map((row) => row.key);
}

/** The user id of a signed-in actor. */
export function userIdOf(actor: Actor): string {
  if (actor.kind !== "user") throw new Error("Not a signed-in user");
  return actor.userId;
}
