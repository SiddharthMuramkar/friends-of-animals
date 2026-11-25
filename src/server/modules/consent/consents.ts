// Giving and withdrawing consent (#64), and reading one's own.
//
//   giveConsent({ purpose, documentId }) → the signed-in user, for themselves
//   withdrawConsent({ purpose })         → the signed-in user, for themselves
//   myConsents()                         → the signed-in user's own
//
// Consent is an event log: each change appends one consent_event, and the
// state is the latest event (./domain/consent-state.ts). A call that would
// change nothing appends nothing. Loads under plain Node: relative imports
// only.

import { z } from "zod";

import { authorize } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { consentEvent } from "../../db/schema";
import { monotonicUuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import { emit } from "../../outbox/emit";
import type { ConsentContext, PublishedConsentDocument } from "./documents";
import {
  currentConsent,
  decideGive,
  decideWithdraw,
  nextEventTime,
  type ConsentEventAction,
  type ConsentState,
} from "./domain/consent-state";
import {
  GIVABLE_PURPOSES,
  WITHDRAWABLE_PURPOSES,
  type ConsentMethod,
  type ConsentPurpose,
  type GivablePurpose,
  type WithdrawablePurpose,
} from "./domain/purposes";
import {
  latestDocument,
  latestProfileEventId,
  lockProfileSubject,
  lockUserSubject,
  subjectEvents,
  type ConsentSubject,
} from "./repository";

export type GiveConsentInput = { purpose: GivablePurpose; documentId: string };

export type GiveConsentResult =
  | { ok: true; changed: boolean }
  | InvalidInput
  | { ok: false; error: "document_outdated" | "no_published_document" };

export type WithdrawConsentResult =
  | { ok: true; changed: boolean }
  | InvalidInput;

/** One event in a person's consent history. */
export type ConsentHistoryItem = {
  id: string;
  action: ConsentEventAction;
  documentId: string;
  documentVersion: number;
  method: ConsentMethod;
  occurredAt: Date;
};

/** A person's consent to one purpose: now, before, and the current text. */
export type MyConsent = {
  purpose: GivablePurpose;
  state: ConsentState;
  /** Newest first. */
  history: ConsentHistoryItem[];
  /** What giving consent now would agree to; null before version 1. */
  currentDocument: PublishedConsentDocument | null;
};

/**
 * Events made in one millisecond still sort in the order they were made,
 * so the latest event is the state.
 */
const nextEventId = monotonicUuidv7();

const giveInput = z.object({
  purpose: z.enum(GIVABLE_PURPOSES),
  documentId: z.uuid(),
});

const withdrawInput = z.object({ purpose: z.enum(GIVABLE_PURPOSES) });

function withdrawable(purpose: ConsentPurpose): WithdrawablePurpose {
  const found = WITHDRAWABLE_PURPOSES.find((each) => each === purpose);
  if (!found) throw new Error(`Consent to ${purpose} can't be withdrawn`);
  return found;
}

function signedInUser(ctx: ConsentContext): string {
  if (ctx.actor.kind !== "user") {
    // authorize() has already refused anyone else.
    throw new Error("Consent use cases need a signed-in user");
  }
  return ctx.actor.userId;
}

/** One event to append to a subject's log. */
export type ConsentEventToAppend = {
  purpose: ConsentPurpose;
  action: ConsentEventAction;
  documentId: string;
  /** The role that allowed it, for the audit log. */
  actorRole?: Role | null;
} & (
  | {
      method: Exclude<ConsentMethod, "otp_link">;
      subject: ConsentSubject;
      giverUserId: string;
      /** Set for guardian or adult publication consent in a competition. */
      competitionId?: string | null;
    }
  | {
      method: "otp_link";
      subject: { type: "participant_profile"; id: string };
      competitionId: string;
      giver: {
        kind: "guardian_contact";
        contactHash: string;
        consentLinkId: string;
      };
    }
);

/**
 * Appends one event for the subject, after `state` (what its log says
 * now, read under the subject's lock), with its audit entry; a withdrawal
 * also emits consent.withdrawn, so all three commit or none do. The entry
 * and the event hold ids only: a consent record says nothing more about
 * the person. Callers have authorized the giver and locked the subject.
 */
export async function appendConsentEvent(
  tx: AppDb,
  ctx: ConsentContext,
  state: ConsentState,
  event: ConsentEventToAppend
): Promise<string> {
  const now = ctx.clock.now();
  let occurredAt = now;
  let id: string;
  if (event.subject.type === "participant_profile") {
    // Under the profile lock, use the UUIDv7 timestamp as the append order
    // across purposes, while preserving the actual occurrence time.
    const lastId = await latestProfileEventId(tx, event.subject.id);
    const lastMs = lastId
      ? Number.parseInt(lastId.replaceAll("-", "").slice(0, 12), 16)
      : -1;
    id = nextEventId(new Date(Math.max(now.getTime(), lastMs + 1)));
  } else {
    occurredAt = nextEventTime(state, now);
    id = nextEventId(occurredAt);
  }
  const contact = event.method === "otp_link" ? event.giver : null;
  await tx.insert(consentEvent).values({
    id,
    subjectType: event.subject.type,
    subjectId: event.subject.id,
    giverUserId: event.method === "otp_link" ? null : event.giverUserId,
    giverContactHash: contact?.contactHash ?? null,
    consentLinkId: contact?.consentLinkId ?? null,
    purpose: event.purpose,
    documentId: event.documentId,
    action: event.action,
    method: event.method,
    competitionId: event.competitionId ?? null,
    occurredAt,
  });
  const ids = {
    consentEventId: id,
    subjectType: event.subject.type,
    subjectId: event.subject.id,
    purpose: event.purpose,
    documentId: event.documentId,
    competitionId: event.competitionId ?? null,
  };
  if (event.action === "withdrawn") {
    // Only a purpose someone gives can be withdrawn.
    const purpose = withdrawable(event.purpose);
    await emit(tx, ctx.clock, {
      type: "consent.withdrawn",
      aggregate: { type: "consent_event", id },
      payload: { ...ids, purpose },
    });
  }
  await recordAudit(
    tx,
    ctx,
    {
      action: `consent.${event.action}`,
      entity: { type: "consent_event", id },
      before: null,
      after: contact ? { ...ids, consentLinkId: contact.consentLinkId } : ids,
      // Giving and withdrawing one's own consent needs no role; a
      // guardian's for a child is allowed by their guardian role.
      actorRole: event.actorRole ?? null,
    },
    { withoutRequestMeta: contact !== null }
  );
  return id;
}

/** What became of the consent box ticked at sign-up. */
export type SignUpConsentOutcome =
  | "given"
  | "document_outdated"
  | "no_published_document";

/**
 * Records the messages consent a person ticked while signing up, in the
 * transaction that creates their account (verifyEmailCode has authorized
 * the visitor). It is given by web form to the version the form showed,
 * if that is still the current one; else it records nothing and says why,
 * and the person can consent in their settings.
 */
export async function recordSignUpConsent(
  tx: AppDb,
  ctx: ConsentContext,
  input: { userId: string; purpose: GivablePurpose; documentId: string }
): Promise<SignUpConsentOutcome> {
  const { userId, purpose, documentId } = input;
  const latest = await latestDocument(tx, purpose);
  const decision = decideGive({ status: "never" }, latest, documentId);
  if (decision.kind === "reject") return decision.code;
  if (decision.kind === "unchanged") return "given";
  await appendConsentEvent(
    tx,
    ctx,
    { status: "never" },
    {
      subject: { type: "user", id: userId },
      giverUserId: userId,
      purpose,
      action: "given",
      documentId: decision.documentId,
      method: "web_form",
    }
  );
  return "given";
}

/**
 * Records the documents a person agreed to while registering for a
 * competition (#78), in the registration's transaction (the register use
 * case has authorized them): each one given by web form to the exact
 * version the competition pinned (#72), which may be older than the
 * latest. A document they already agreed to, at that version, records
 * nothing again.
 */
export async function recordRegistrationConsents(
  tx: AppDb,
  ctx: ConsentContext,
  input: {
    userId: string;
    documents: readonly { purpose: ConsentPurpose; documentId: string }[];
    competitionId?: string;
  }
): Promise<void> {
  if (input.documents.length === 0) return;
  const subject: ConsentSubject = { type: "user", id: input.userId };
  const competitionId = input.competitionId ?? null;
  await lockUserSubject(tx, input.userId);
  for (const { purpose, documentId } of input.documents) {
    const state = currentConsent(
      await subjectEvents(tx, subject, purpose, competitionId, input.userId)
    );
    if (state.status === "given" && state.documentId === documentId) continue;
    await appendConsentEvent(tx, ctx, state, {
      subject,
      giverUserId: input.userId,
      purpose,
      action: "given",
      documentId,
      method: "web_form",
      competitionId,
    });
  }
}

/** A consent a campaign message rested on (#126), to withdraw by its link. */
export type MessageLinkConsent =
  | { purpose: "messages"; userId: string }
  | { purpose: "communications"; childId: string; guardianUserId: string };

/**
 * Withdraws one consent by the withdrawal link of a message sent on it
 * (#126): a person's own consent to News and updates, or the consent their
 * guardian gave to messages about a child, withdrawn by that guardian. The
 * caller has authorized the link's holder and checked the guardian still
 * looks after the child. Records nothing when the consent isn't given, and
 * says whether it recorded a withdrawal.
 */
export async function withdrawByMessageLink(
  tx: AppDb,
  ctx: ConsentContext,
  consent: MessageLinkConsent
): Promise<boolean> {
  const own = consent.purpose === "messages";
  const subject: ConsentSubject = own
    ? { type: "user", id: consent.userId }
    : { type: "participant_profile", id: consent.childId };
  if (own) await lockUserSubject(tx, consent.userId);
  else await lockProfileSubject(tx, consent.childId);
  const state = own
    ? currentConsent(await subjectEvents(tx, subject, "messages"))
    : currentConsent(
        await subjectEvents(tx, subject, "communications", null),
        "id"
      );
  const decision = decideWithdraw(state);
  if (decision.kind !== "record") return false;
  await appendConsentEvent(tx, ctx, state, {
    subject,
    giverUserId: own ? consent.userId : consent.guardianUserId,
    purpose: consent.purpose,
    action: "withdrawn",
    documentId: decision.documentId,
    method: "web_form",
  });
  return true;
}

/** Gives the signed-in user's consent to the purpose's current document. */
export async function giveConsent(
  ctx: ConsentContext,
  input: GiveConsentInput
): Promise<GiveConsentResult> {
  await authorize(ctx, "consent.give");
  const parsed = giveInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { purpose, documentId } = parsed.data;
  const userId = signedInUser(ctx);
  const subject: ConsentSubject = { type: "user", id: userId };

  return ctx.db.transaction(async (tx) => {
    await lockUserSubject(tx, userId);
    const state = currentConsent(await subjectEvents(tx, subject, purpose));
    const latest = await latestDocument(tx, purpose);
    const decision = decideGive(state, latest, documentId);
    if (decision.kind === "reject") {
      return { ok: false, error: decision.code } as const;
    }
    if (decision.kind === "unchanged") return { ok: true, changed: false };
    await appendConsentEvent(tx, ctx, state, {
      subject,
      giverUserId: userId,
      purpose,
      action: "given",
      documentId: decision.documentId,
      method: "web_form",
    });
    return { ok: true, changed: true };
  });
}

/** Withdraws the signed-in user's consent to the purpose, if given. */
export async function withdrawConsent(
  ctx: ConsentContext,
  input: { purpose: GivablePurpose }
): Promise<WithdrawConsentResult> {
  await authorize(ctx, "consent.withdraw");
  const parsed = withdrawInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { purpose } = parsed.data;
  const userId = signedInUser(ctx);
  const subject: ConsentSubject = { type: "user", id: userId };

  return ctx.db.transaction(async (tx) => {
    await lockUserSubject(tx, userId);
    const state = currentConsent(await subjectEvents(tx, subject, purpose));
    const decision = decideWithdraw(state);
    if (decision.kind !== "record") return { ok: true, changed: false };
    await appendConsentEvent(tx, ctx, state, {
      subject,
      giverUserId: userId,
      purpose,
      action: "withdrawn",
      documentId: decision.documentId,
      method: "web_form",
    });
    return { ok: true, changed: true };
  });
}

/** The signed-in user's consent to each purpose they can give. */
export async function myConsents(ctx: ConsentContext): Promise<MyConsent[]> {
  await authorize(ctx, "consent.view_own");
  const subject: ConsentSubject = { type: "user", id: signedInUser(ctx) };
  return Promise.all(
    GIVABLE_PURPOSES.map(async (purpose) => {
      const history = await subjectEvents(ctx.db, subject, purpose);
      return {
        purpose,
        state: currentConsent(history),
        history,
        currentDocument: await latestDocument(ctx.db, purpose),
      };
    })
  );
}
