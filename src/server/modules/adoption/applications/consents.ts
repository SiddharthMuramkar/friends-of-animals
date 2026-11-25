// An adopter's two consents (#130), through the consent module's event log
// (ADR 0009): sharing their contact details with the listing organisation,
// given when they apply, and sharing their success story, given when they
// write it. Each is given by web form on the version the adopter was
// shown, which must be the current one. Loads under plain Node: relative
// imports only.

import type { AppDb } from "../../../db/app-db";
import { appendConsentEvent } from "../../consent/consents";
import type { ConsentContext } from "../../consent/documents";
import { currentConsent } from "../../consent/domain/consent-state";
import type { AdoptionPurpose } from "../../consent/domain/purposes";
import { latestDocument, subjectEvents } from "../../consent/repository";

export type AdopterConsentRefusal = "consent_unpublished" | "consent_outdated";

/**
 * Records the user's consent to `purpose` on the document they were shown,
 * inside the caller's transaction (which holds the user's consent lock).
 * Already given on that version records nothing again. Returns the event
 * the consent rests on.
 */
export async function recordAdopterConsent(
  tx: AppDb,
  ctx: ConsentContext,
  userId: string,
  purpose: AdoptionPurpose,
  shownDocumentId: string
): Promise<
  | { ok: true; consentEventId: string }
  | { ok: false; error: AdopterConsentRefusal }
> {
  const latest = await latestDocument(tx, purpose);
  if (!latest) return { ok: false, error: "consent_unpublished" };
  if (latest.id !== shownDocumentId) {
    return { ok: false, error: "consent_outdated" };
  }
  const subject = { type: "user", id: userId } as const;
  const events = await subjectEvents(tx, subject, purpose);
  const state = currentConsent(events);
  if (state.status === "given" && state.documentId === shownDocumentId) {
    // Newest first: the event that gave it.
    return { ok: true, consentEventId: events[0]!.id };
  }
  const consentEventId = await appendConsentEvent(tx, ctx, state, {
    subject,
    giverUserId: userId,
    purpose,
    action: "given",
    documentId: shownDocumentId,
    method: "web_form",
  });
  return { ok: true, consentEventId };
}

/** Whether the user's consent to `purpose` stands now. */
export async function adopterConsentGiven(
  db: AppDb,
  userId: string,
  purpose: AdoptionPurpose
): Promise<boolean> {
  const events = await subjectEvents(db, { type: "user", id: userId }, purpose);
  return currentConsent(events).status === "given";
}

/**
 * Withdraws the user's consent to share success stories, inside the
 * caller's transaction; emits consent.withdrawn. False when it wasn't given.
 */
export async function withdrawStoryConsent(
  tx: AppDb,
  ctx: ConsentContext,
  userId: string
): Promise<boolean> {
  const subject = { type: "user", id: userId } as const;
  const state = currentConsent(
    await subjectEvents(tx, subject, "adoption_success_story")
  );
  if (state.status !== "given") return false;
  await appendConsentEvent(tx, ctx, state, {
    subject,
    giverUserId: userId,
    purpose: "adoption_success_story",
    action: "withdrawn",
    documentId: state.documentId,
    method: "web_form",
  });
  return true;
}

/** The current version of a purpose's document, for a form to show. */
export async function currentAdopterDocument(
  db: AppDb,
  purpose: AdoptionPurpose
) {
  const latest = await latestDocument(db, purpose);
  return latest
    ? {
        id: latest.id,
        version: latest.version,
        title: latest.title,
        body: latest.body,
      }
    : null;
}
