// Shared set-up for the campaigns module's Seam 1 tests (#126): a signed-in
// community manager, people who consented to News and updates (or didn't),
// and a guardian who consented to messages about their child. Everything is
// made through the real use cases, so consent is the consent module's own.
// Test code only; nothing in the app imports it.

import { and, asc, eq } from "drizzle-orm";

import type { Actor } from "@/server/actor";
import type { Grant } from "@/server/access/domain/roles";
import { auditLog } from "@/server/db/schema";
import { insertConsentDocumentVersion } from "@/server/modules/consent/insert-version";
import { parseConsentDocumentBody } from "@/server/modules/consent/domain/document-body";
import {
  adultForm,
  type OpenCompetition,
} from "@/server/modules/participants/testing";
import { childForm } from "@/server/modules/consent/testing";
import type { Harness } from "@/test/harness";

import type { SegmentDefinition } from "./domain/segment";

export const EVERYONE: SegmentDefinition = {
  roles: [],
  competitionIds: [],
  cities: [],
};

export const SAMPLE_CONTENT = {
  subject: "Adoption camp this Sunday",
  body: "Meet dogs and cats looking for a home.\n\nBring a friend.",
};

let managers = 0;

/** A signed-in community manager who passed the second factor. */
export async function communityManager(h: Harness): Promise<Actor> {
  managers += 1;
  const account = await h.seed.member({
    name: "Kavya Community",
    email: `community-${managers}@example.test`,
  });
  await h.seed.grant(account, {
    role: "community_manager",
    scope: { type: "global" },
  });
  return h.signIn(account);
}

/** Publishes the next version of a consent document straight into the table. */
export async function publishDocument(
  h: Harness,
  purpose: "messages" | "communications"
): Promise<string> {
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
  const { id } = await h.db.transaction((tx) =>
    insertConsentDocumentVersion(
      tx,
      { now: h.clock.now(), publishedByUserId: null },
      { purpose, title: null, body: parsed.body, legalRevisionId: null }
    )
  );
  return id;
}

export type Person = {
  actor: Actor;
  userId: string;
  email: string;
};

/**
 * A member who has (or, with `consent: false`, has not) agreed to News and
 * updates, with any `grants`, registered for `competition` if given.
 */
export async function person(
  h: Harness,
  details: {
    name: string;
    email: string;
    consent?: boolean;
    grants?: Grant[];
    registerFor?: { competition: OpenCompetition; city?: string };
  }
): Promise<Person> {
  const account = await h.seed.member({
    name: details.name,
    email: details.email,
  });
  if (details.grants) await h.seed.grant(account, ...details.grants);
  const actor = await h.signIn(account, undefined, { secondFactor: false });
  if (details.consent ?? true) {
    const documentId = await currentDocument(h, "messages");
    const given = await h
      .as(actor)
      .giveConsent({ purpose: "messages", documentId });
    if (!given.ok) throw new Error("Could not give consent");
  }
  if (details.registerFor) {
    const registered = await h.as(actor).registerAsIndividual(
      adultForm(details.registerFor.competition, {
        fullName: details.name,
        ...(details.registerFor.city ? { city: details.registerFor.city } : {}),
      })
    );
    if (!registered.ok) throw new Error(`Registering failed: ${registered.error}`);
  }
  return { actor, userId: account.id, email: account.email };
}

const documents = new WeakMap<Harness, Map<string, string>>();

async function currentDocument(
  h: Harness,
  purpose: "messages" | "communications"
): Promise<string> {
  const known = documents.get(h) ?? new Map<string, string>();
  documents.set(h, known);
  const found = known.get(purpose);
  if (found) return found;
  const id = await publishDocument(h, purpose);
  known.set(purpose, id);
  return id;
}

/**
 * A verified guardian of one child, the child registered for
 * `competition` from `city`, with (or without) the guardian's consent to
 * messages about the child.
 */
export async function guardianOfChild(
  h: Harness,
  details: {
    name: string;
    email: string;
    competition: OpenCompetition;
    childName?: string;
    childAge?: number;
    city?: string;
    consent?: boolean;
    loginUserId?: string;
  }
): Promise<Person & { childId: string }> {
  const { account, childIds } = await h.seed.guardian({
    name: details.name,
    email: details.email,
    children: [
      {
        fullName: details.childName ?? "Asha Kulkarni",
        age: details.childAge ?? 9,
        ...(details.loginUserId ? { loginUserId: details.loginUserId } : {}),
      },
    ],
  });
  const childId = childIds[0]!;
  const actor = await h.signIn(account, undefined, { secondFactor: false });
  const registered = await h.as(actor).registerAsIndividual({
    ...childForm(details.competition, childId),
    ...(details.city ? { city: details.city } : {}),
  });
  if (!registered.ok) throw new Error(`Registering failed: ${registered.error}`);
  if (details.consent ?? true) {
    const documentId = await currentDocument(h, "communications");
    const given = await h.as(actor).giveChildConsent({
      childId,
      purpose: "communications",
      documentId,
    });
    if (!given.ok) throw new Error(`Child consent failed: ${given.error}`);
  }
  return { actor, userId: account.id, email: account.email, childId };
}

/** A draft campaign to `segment`, made through the use case. */
export async function draftCampaign(
  h: Harness,
  manager: Actor,
  segment: Partial<SegmentDefinition> = {},
  content = SAMPLE_CONTENT
) {
  const created = await h
    .as(manager)
    .createCampaign({ ...content, segment: { ...EVERYONE, ...segment } });
  if (!created.ok) throw new Error(`Creating failed: ${created.error}`);
  return created.campaign;
}

/** Sends a draft through the use case and fails loudly if refused. */
export async function sendDraft(
  h: Harness,
  manager: Actor,
  campaign: { id: string; revision: number }
) {
  const sent = await h
    .as(manager)
    .sendCampaign({ id: campaign.id, revision: campaign.revision });
  if (!sent.ok) throw new Error(`Sending failed: ${sent.error}`);
  return sent;
}

/** The withdrawal link in the latest campaign email to `email`. */
export function withdrawalTokenIn(h: Harness, email: string): string {
  const message = h.email.lastTo(email);
  const token = message?.text.match(/\/withdraw\/([0-9a-f]{64})/)?.[1];
  if (!token) throw new Error(`No withdrawal link was emailed to ${email}`);
  return token;
}

/** The campaign audit entries, oldest first. */
export function campaignAudit(h: Harness, campaignId: string) {
  return h.db
    .select({
      action: auditLog.action,
      before: auditLog.before,
      after: auditLog.after,
      actorRole: auditLog.actorRole,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityType, "campaign"),
        eq(auditLog.entityId, campaignId)
      )
    )
    .orderBy(asc(auditLog.occurredAt), asc(auditLog.id));
}
