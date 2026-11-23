// Shared set-up for guardian consent's Seam 1 tests (#82): a verified
// guardian with a child registered for a competition open to individuals,
// with the guardian consent documents attached, and the rows to assert on.
// Test code only; nothing in the app imports it.

import { and, asc, eq, inArray } from "drizzle-orm";

import type { Actor } from "@/server/actor";
import {
  auditLog,
  competitionConsentDocument,
  consentEvent,
  outbox,
  registration,
} from "@/server/db/schema";
import { insertConsentDocumentVersion } from "@/server/modules/consent/insert-version";
import { parseConsentDocumentBody } from "@/server/modules/consent/domain/document-body";
import {
  adultForm,
  openToIndividuals,
  type GuardianDocumentPurpose,
  type OpenCompetition,
} from "@/server/modules/participants/testing";
import type { Harness } from "@/test/harness";

/** Children's, teens' and adults' groups, counted on 1 June 2027. */
export const ALL_AGES = [
  { label: "6–12", minAge: 6, maxAge: 12 },
  { label: "13–17", minAge: 13, maxAge: 17 },
  { label: "Adults", minAge: 18, maxAge: 99 },
];

export const ALL_GUARDIAN_DOCUMENTS: readonly GuardianDocumentPurpose[] = [
  "participation",
  "public_display",
  "social_media",
  "auction",
];

/**
 * A competition open to individuals of every age that allows public
 * display and auction, with every guardian document attached unless told
 * otherwise.
 */
export function consentCompetition(
  h: Harness,
  options: Parameters<typeof openToIndividuals>[1] = {}
) {
  return openToIndividuals(h, {
    ageGroups: ALL_AGES,
    publicDisplay: true,
    auctionPermitted: true,
    guardianDocuments: ALL_GUARDIAN_DOCUMENTS,
    ...options,
  });
}

/**
 * The form a guardian sends for their child: the documents the registrant
 * agrees to, and participation only when `participation` is true.
 */
export function childForm(
  competition: OpenCompetition,
  childId: string,
  { participation = false }: { participation?: boolean } = {}
) {
  const guardianOnly = new Set(Object.values(competition.guardianDocuments));
  const kept = competition.guardianDocuments.participation;
  const {
    fullName: _name,
    dateOfBirth: _dob,
    ...form
  } = adultForm(competition, {
    consents: competition.documents.filter(
      (id) => !guardianOnly.has(id) || (participation && id === kept)
    ),
  });
  return { ...form, forChildId: childId };
}

/**
 * A signed-in verified guardian with one child (9 by default, or the age
 * given, with a login when `loginUserId` is given), registered for
 * `competition` without participation consent.
 */
export async function guardianWithChild(
  h: Harness,
  competition: OpenCompetition,
  child: { fullName?: string; age?: number; loginUserId?: string } = {}
): Promise<{
  actor: Actor;
  userId: string;
  childId: string;
  registrationId: string;
}> {
  const { account, childIds } = await h.seed.guardian({
    children: [
      {
        fullName: child.fullName ?? "Asha Kulkarni",
        age: child.age ?? 9,
        ...(child.loginUserId ? { loginUserId: child.loginUserId } : {}),
      },
    ],
  });
  const childId = childIds[0]!;
  const actor = await h.signIn(account);
  const registered = await h
    .as(actor)
    .registerAsIndividual(childForm(competition, childId));
  if (!registered.ok) {
    throw new Error(`Registering the child failed: ${registered.error}`);
  }
  return {
    actor,
    userId: account.id,
    childId,
    registrationId: registered.registrationId,
  };
}

/** Publishes the next version of a guardian document straight into the table. */
export async function publishNextVersion(
  h: Harness,
  purpose: GuardianDocumentPurpose | "communications",
  title = `Draft ${purpose}`
): Promise<{ id: string; version: number }> {
  const parsed = parseConsentDocumentBody({
    short: [[`Draft ${purpose} consent.`]],
    sections: [
      {
        id: "what-you-agree-to",
        title: "What you agree to",
        blocks: [{ p: [`Draft ${purpose} text. Not FOA's words.`] }],
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.issues.join("; "));
  return h.db.transaction((tx) =>
    insertConsentDocumentVersion(
      tx,
      { now: h.clock.now(), publishedByUserId: null },
      { purpose, title, body: parsed.body, legalRevisionId: null }
    )
  );
}

/** Moves the competition's pin of `purpose` to `documentId`. */
export async function reattach(
  h: Harness,
  competitionId: string,
  purpose: GuardianDocumentPurpose,
  documentId: string
) {
  await h.db
    .update(competitionConsentDocument)
    .set({ consentDocumentId: documentId })
    .where(
      and(
        eq(competitionConsentDocument.competitionId, competitionId),
        eq(competitionConsentDocument.purpose, purpose)
      )
    );
}

/**
 * Children's consent events, the consent.withdrawn outbox rows and the
 * audit entries of those events (a guardian's own consents to the
 * competition's terms, given on the registration form, are left out).
 */
export async function consentRows(h: Harness) {
  const events = await h.db
    .select()
    .from(consentEvent)
    .where(eq(consentEvent.subjectType, "participant_profile"))
    .orderBy(asc(consentEvent.occurredAt), asc(consentEvent.id));
  const ids = events.map((event) => event.id);
  return {
    events,
    outbox: await h.db
      .select()
      .from(outbox)
      .where(eq(outbox.eventType, "consent.withdrawn"))
      .orderBy(asc(outbox.id)),
    audit:
      ids.length === 0
        ? []
        : await h.db
            .select()
            .from(auditLog)
            .where(
              and(
                eq(auditLog.entityType, "consent_event"),
                inArray(auditLog.entityId, ids)
              )
            )
            .orderBy(asc(auditLog.id)),
  };
}

/** The registration's status now. */
export async function statusOf(h: Harness, registrationId: string) {
  const [row] = await h.db
    .select({ status: registration.status })
    .from(registration)
    .where(eq(registration.id, registrationId));
  return row?.status;
}
