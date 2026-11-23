// A guardian's consent for a child (#82), one purpose at a time:
//
//   childConsents({ childId })              → each competition the child is
//       registered in, with every purpose's offer, version and state, the
//       credit each public use would show, and communications
//   giveChildConsent({ childId, competitionId?, purpose, documentId })
//   withdrawChildConsent({ childId, competitionId?, purpose })
//   childConsentHistory({ childId })        → every event, newest first
//
// All four are the child's verified guardian's (./policy.ts). Consent is
// #64's event log: the subject is the child's participant profile, the
// giver the guardian, and a competition purpose names its competition, so
// each competition keeps its own log per purpose; the state is the latest
// event. Consent always points at the version the competition has
// attached (#72), or for communications the current one: giving another
// is refused as outdated. A call that would change nothing appends
// nothing. Giving participation releases the child's registration held
// for it (./participation-gate.ts) in the same transaction.
//
// Loads under plain Node: relative imports only.

import { and, desc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";

import { authorize, can } from "../../access/can";
import type { Role } from "../../access/domain/roles";
import type { AppDb } from "../../db/app-db";
import {
  competition,
  consentDocument,
  consentEvent,
  participantProfile,
  registration,
  user,
} from "../../db/schema";
import { DomainError } from "../../errors";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { pinnedDocuments } from "../competitions/terms/repository";
import { childResource } from "../guardians/child-access";
import { childDateOfBirth } from "../guardians/child-view";
import { guardianOfUser } from "../guardians/guardian-record";
import { isAdultAt } from "../participants/domain/age";
import { appendConsentEvent } from "./consents";
import {
  childConsentsView,
  type CompetitionPurposeView,
  type PurposeState,
} from "./domain/child-consents";
import {
  currentConsent,
  decideGive,
  decideWithdraw,
  type ConsentEventAction,
  type ConsentEventRecord,
} from "./domain/consent-state";
import type { ConsentDocumentBody } from "./domain/document-body";
import {
  documentToGive,
  GUARDIAN_PURPOSES,
  offeredPurposes,
  publicationPurposeFor,
  scopeRefusal,
  type CompetitionConsentSetup,
  type CompetitionDocumentPurpose,
  type GiveRefusal,
  type GuardianPurpose,
  type PublicUse,
  type ScopeRefusal,
} from "./domain/guardian-purposes";
import {
  nameParts,
  resolvePublicCredit,
  type PublicCredit,
} from "./domain/public-credit";
import type { ConsentMethod } from "./domain/purposes";
import { releaseOnParticipation } from "./participation-gate";
import {
  latestDocument,
  lockProfileSubject,
  subjectEvents,
  type ConsentSubject,
} from "./repository";

/** A document version as the guardian's page shows and links it. */
export type ChildConsentDocument = {
  id: string;
  version: number;
  title: string;
};

export type ChildConsentPurpose = Omit<CompetitionPurposeView, "document"> & {
  document: ChildConsentDocument | null;
};

export type ChildConsents = {
  ok: true;
  child: { id: string; fullName: string };
  competitions: {
    id: string;
    title: string;
    purposes: ChildConsentPurpose[];
    creditPreview: Record<PublicUse, PublicCredit | null>;
  }[];
  communications: {
    document: (ChildConsentDocument & { body: ConsentDocumentBody }) | null;
    state: PurposeState;
    counts: boolean;
  };
};

export type NotVerified = { ok: false; error: "guardian_not_verified" };

export type GiveChildConsentInput = {
  childId: string;
  /** For a competition purpose; left out for communications. */
  competitionId?: string;
  purpose: GuardianPurpose;
  documentId: string;
};

export type WithdrawChildConsentInput = Omit<
  GiveChildConsentInput,
  "documentId"
>;

export type GiveChildConsentResult =
  | { ok: true; changed: boolean }
  | InvalidInput
  | NotVerified
  | {
      ok: false;
      error: GiveRefusal | "document_outdated" | "no_published_document";
    };

export type WithdrawChildConsentResult =
  | { ok: true; changed: boolean }
  | InvalidInput
  | NotVerified
  | { ok: false; error: ScopeRefusal };

/** One event in a child's consent history. */
export type ChildConsentHistoryItem = {
  id: string;
  purpose: GuardianPurpose;
  /** Null for communications. */
  competition: { id: string; title: string } | null;
  action: ConsentEventAction;
  document: ChildConsentDocument;
  /** Null once the giver's account is gone. */
  giverName: string | null;
  method: ConsentMethod;
  occurredAt: Date;
};

export type ChildConsentHistory = {
  ok: true;
  child: { id: string; fullName: string };
  /** Newest first. */
  events: ChildConsentHistoryItem[];
};

type ChildAction =
  | "consent.child.give"
  | "consent.child.withdraw"
  | "consent.child.read";

const purposeInput = z.enum(GUARDIAN_PURPOSES);

export const giveChildConsentInput = z.object({
  childId: z.uuid(),
  competitionId: z.uuid().optional(),
  purpose: purposeInput,
  documentId: z.uuid(),
});

export const withdrawChildConsentInput = giveChildConsentInput.omit({
  documentId: true,
});

const childInput = z.object({ childId: z.uuid() });

/** Registrations a child no longer takes part through. */
const ENDED = ["withdrawn", "refunded"] as const;

/**
 * Authorizes the child's guardian; a guardian who has declared but not
 * verified is told so rather than refused outright, like adding a child.
 * Anyone else is refused as forbidden, whether or not the child exists.
 */
async function authorizeGuardian(
  ctx: Pick<UseCaseContext, "db" | "clock" | "actor">,
  action: ChildAction,
  childId: unknown
): Promise<{ ok: true; userId: string; role: Role | null } | NotVerified> {
  const decision = await can(
    ctx,
    action,
    await childResource(ctx.db, ctx.actor, childId)
  );
  if (decision.allowed && ctx.actor.kind === "user") {
    return { ok: true, userId: ctx.actor.userId, role: decision.role };
  }
  if (ctx.actor.kind === "user") {
    const record = await guardianOfUser(ctx.db, ctx.actor.userId);
    if (record && !record.verifiedAt) {
      return { ok: false, error: "guardian_not_verified" };
    }
  }
  throw new DomainError("forbidden", `${ctx.actor.kind} may not ${action}`);
}

function subjectOf(childId: string): ConsentSubject {
  return { type: "participant_profile", id: childId };
}

/** What the competition says about consent, or null for no competition. */
async function competitionSetup(
  db: AppDb,
  competitionId: string
): Promise<{
  title: string;
  setup: CompetitionConsentSetup;
  documents: ChildConsentDocument[];
} | null> {
  const [found] = await db
    .select({
      name: competition.name,
      publicDisplay: competition.publicDisplay,
      auctionPermitted: competition.auctionPermitted,
    })
    .from(competition)
    .where(eq(competition.id, competitionId));
  if (!found) return null;
  const pinned = await pinnedDocuments(db, competitionId);
  const attached: CompetitionConsentSetup["attached"] = {};
  for (const document of pinned) {
    if (isCompetitionDocument(document.purpose)) {
      attached[document.purpose] = {
        id: document.id,
        version: document.version,
      };
    }
  }
  return {
    title: found.name,
    setup: {
      publicDisplayAllowed: found.publicDisplay,
      auctionAllowed: found.auctionPermitted,
      attached,
    },
    documents: pinned.map(({ id, version, title }) => ({ id, version, title })),
  };
}

const COMPETITION_DOCUMENTS: readonly string[] = [
  "participation",
  "public_display",
  "social_media",
  "auction",
] satisfies CompetitionDocumentPurpose[];

function isCompetitionDocument(
  purpose: string
): purpose is CompetitionDocumentPurpose {
  return COMPETITION_DOCUMENTS.includes(purpose);
}

/** The child's registration for the competition that still takes part. */
async function liveRegistration(
  db: AppDb,
  childId: string,
  competitionId: string
) {
  const [found] = await db
    .select({ id: registration.id, createdAt: registration.createdAt })
    .from(registration)
    .where(
      and(
        eq(registration.participantProfileId, childId),
        eq(registration.competitionId, competitionId),
        notInArray(registration.status, [...ENDED])
      )
    )
    .limit(1);
  return found ?? null;
}

export async function giveChildConsent(
  ctx: UseCaseContext,
  input: GiveChildConsentInput
): Promise<GiveChildConsentResult> {
  const allowed = await authorizeGuardian(
    ctx,
    "consent.child.give",
    input?.childId
  );
  if (!allowed.ok) return allowed;
  const parsed = giveChildConsentInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { childId, purpose, documentId } = parsed.data;
  const competitionId = parsed.data.competitionId ?? null;

  return ctx.db.transaction(async (tx): Promise<GiveChildConsentResult> => {
    if (purpose === "participation" && competitionId !== null) {
      await tx
        .select({ id: competition.id })
        .from(competition)
        .where(eq(competition.id, competitionId))
        .for("share");
    }
    await lockProfileSubject(tx, childId);
    // Again under the child's lock: a link revoked since counts.
    const { role } = await authorize(
      { db: tx, clock: ctx.clock, actor: ctx.actor },
      "consent.child.give",
      await childResource(tx, ctx.actor, childId)
    );
    const scope = scopeRefusal(purpose, competitionId);
    if (scope) return { ok: false, error: scope };
    let target: Parameters<typeof documentToGive>[1];
    if (competitionId === null) {
      target = {
        competition: null,
        currentDocument: await latestDocument(tx, "communications"),
      };
    } else {
      const found = await competitionSetup(tx, competitionId);
      const entry = await liveRegistration(tx, childId, competitionId);
      if (!found || !entry) return { ok: false, error: "not_registered" };
      const child = await childFacts({ db: tx, cipher: ctx.cipher }, childId);
      if (isAdultAt(child.dateOfBirth, entry.createdAt)) {
        return { ok: false, error: "purpose_not_offered" };
      }
      target = {
        competition: found.setup,
        childRegistered: true,
      };
    }
    const toGive = documentToGive(purpose, target);
    if (!toGive.ok) return { ok: false, error: toGive.reason };

    const subject = subjectOf(childId);
    const state = currentConsent(
      await subjectEvents(tx, subject, purpose, competitionId),
      "id"
    );
    // The version the guardian would agree to is the latest that counts.
    const decision = decideGive(state, toGive.document, documentId);
    if (decision.kind === "reject") return { ok: false, error: decision.code };
    if (decision.kind === "unchanged") return { ok: true, changed: false };
    await appendConsentEvent(tx, ctx, state, {
      subject,
      giverUserId: allowed.userId,
      purpose,
      action: "given",
      documentId: decision.documentId,
      method: "web_form",
      competitionId,
      actorRole: role,
    });
    if (purpose === "participation" && competitionId !== null) {
      await releaseOnParticipation(tx, ctx, {
        profileId: childId,
        competitionId,
        actorRole: role,
      });
    }
    return { ok: true, changed: true };
  });
}

export async function withdrawChildConsent(
  ctx: UseCaseContext,
  input: WithdrawChildConsentInput
): Promise<WithdrawChildConsentResult> {
  const allowed = await authorizeGuardian(
    ctx,
    "consent.child.withdraw",
    input?.childId
  );
  if (!allowed.ok) return allowed;
  const parsed = withdrawChildConsentInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { childId, purpose } = parsed.data;
  const competitionId = parsed.data.competitionId ?? null;
  // Only the scope: a consent stays withdrawable after its competition
  // stops offering the purpose, or the child's registration ends.
  const scope = scopeRefusal(purpose, competitionId);
  if (scope) return { ok: false, error: scope };

  return ctx.db.transaction(async (tx): Promise<WithdrawChildConsentResult> => {
    await lockProfileSubject(tx, childId);
    const { role } = await authorize(
      { db: tx, clock: ctx.clock, actor: ctx.actor },
      "consent.child.withdraw",
      await childResource(tx, ctx.actor, childId)
    );
    if (purpose === "participation" && competitionId !== null) {
      // Confirmation holds these rows while checking consent and updating
      // status. Give and withdraw both lock the profile first.
      await tx
        .select({ id: registration.id })
        .from(registration)
        .where(
          and(
            eq(registration.participantProfileId, childId),
            eq(registration.competitionId, competitionId),
            eq(registration.route, "individual")
          )
        )
        .orderBy(registration.id)
        .for("update");
    }
    const subject = subjectOf(childId);
    const state = currentConsent(
      await subjectEvents(tx, subject, purpose, competitionId),
      "id"
    );
    const decision = decideWithdraw(state);
    if (decision.kind !== "record") return { ok: true, changed: false };
    await appendConsentEvent(tx, ctx, state, {
      subject,
      giverUserId: allowed.userId,
      purpose,
      action: "withdrawn",
      documentId: decision.documentId,
      method: "web_form",
      competitionId,
      actorRole: role,
    });
    return { ok: true, changed: true };
  });
}

/** The child's name and what the credit may show. */
async function childFacts(
  ctx: Pick<UseCaseContext, "db" | "cipher">,
  childId: string
) {
  const [row] = await ctx.db
    .select({
      fullName: participantProfile.fullName,
      dobCiphertext: participantProfile.dobCiphertext,
      ownerKind: participantProfile.ownerKind,
      ownerUserId: participantProfile.ownerUserId,
      loginUserId: participantProfile.loginUserId,
      schoolName: participantProfile.schoolName,
      city: participantProfile.city,
    })
    .from(participantProfile)
    .where(eq(participantProfile.id, childId));
  // The policy allowed a guardian linked to this child, so it exists.
  if (!row) throw new Error(`Child ${childId} is gone`);
  return { ...row, dateOfBirth: childDateOfBirth(ctx, row).date };
}

/** Every event of the child's log, with what the views name. */
async function childEvents(db: AppDb, childId: string, competitionId?: string) {
  return db
    .select({
      id: consentEvent.id,
      purpose: consentEvent.purpose,
      competitionId: consentEvent.competitionId,
      competitionTitle: competition.name,
      action: consentEvent.action,
      documentId: consentEvent.documentId,
      documentVersion: consentDocument.version,
      documentTitle: consentDocument.title,
      giverName: user.name,
      method: consentEvent.method,
      occurredAt: consentEvent.occurredAt,
    })
    .from(consentEvent)
    .innerJoin(consentDocument, eq(consentDocument.id, consentEvent.documentId))
    .leftJoin(competition, eq(competition.id, consentEvent.competitionId))
    .leftJoin(user, eq(user.id, consentEvent.giverUserId))
    .where(
      and(
        eq(consentEvent.subjectType, "participant_profile"),
        eq(consentEvent.subjectId, childId),
        competitionId === undefined
          ? undefined
          : eq(consentEvent.competitionId, competitionId)
      )
    )
    .orderBy(desc(consentEvent.id));
}

/**
 * A publication caller gets only the credit allowed for this competition
 * and use. Other publication checks, such as whether an entry is released,
 * belong to the caller.
 */
export async function publicUse(
  ctx: Pick<UseCaseContext, "db" | "cipher">,
  input: { profileId: string; competitionId: string; use: PublicUse }
): Promise<PublicCredit | null> {
  const { profileId, competitionId, use } = input;
  const registration = await liveRegistration(ctx.db, profileId, competitionId);
  if (!registration) return null;
  const found = await competitionSetup(ctx.db, competitionId);
  if (!found) return null;
  const child = await childFacts(ctx, profileId);
  const person = {
    ...nameParts(child.fullName),
    fullName: child.fullName,
    schoolName: child.schoolName,
    city: child.city,
  };
  if (isAdultAt(child.dateOfBirth, registration.createdAt)) {
    const userId =
      child.ownerKind === "self" ? child.ownerUserId : child.loginUserId;
    if (userId === null) return null;
    const purpose = publicationPurposeFor(use);
    const offer = offeredPurposes(found.setup).find(
      (choice) => choice.purpose === purpose
    );
    if (!offer) return null;
    const state = currentConsent(
      await subjectEvents(
        ctx.db,
        { type: "user", id: userId },
        purpose,
        competitionId,
        userId
      )
    );
    if (state.status !== "given" || state.documentId !== offer.document.id)
      return null;
    return resolvePublicCredit(
      { ...person, minor: false },
      use,
      new Set([purpose])
    );
  }

  const events = await childEvents(ctx.db, profileId, competitionId);
  const view = childConsentsView({
    child: person,
    competitions: [
      {
        id: competitionId,
        title: found.title,
        setup: found.setup,
        minor: true,
      },
    ],
    states: (_, purpose) =>
      currentConsent(
        events.filter((event) => event.purpose === purpose),
        "id"
      ),
    communicationsDocument: null,
  });
  return view.competitions[0]?.creditPreview[use] ?? null;
}

function isGuardianPurpose(purpose: string): purpose is GuardianPurpose {
  return (GUARDIAN_PURPOSES as readonly string[]).includes(purpose);
}

export async function childConsents(
  ctx: UseCaseContext,
  input: { childId: string }
): Promise<ChildConsents | NotVerified> {
  const allowed = await authorizeGuardian(
    ctx,
    "consent.child.read",
    input.childId
  );
  if (!allowed.ok) return allowed;
  const { childId } = childInput.parse(input);
  const child = await childFacts(ctx, childId);

  // The competitions the child takes part in, then any whose consent is
  // still on the log, so it stays withdrawable.
  const registered = await ctx.db
    .select({
      competitionId: registration.competitionId,
      createdAt: registration.createdAt,
    })
    .from(registration)
    .where(
      and(
        eq(registration.participantProfileId, childId),
        notInArray(registration.status, [...ENDED])
      )
    )
    .orderBy(registration.createdAt, registration.id);
  const events = await childEvents(ctx.db, childId);
  const registeredAsMinor = new Set(
    registered
      .filter((row) => !isAdultAt(child.dateOfBirth, row.createdAt))
      .map((row) => row.competitionId)
  );
  const competitionIds = [
    ...registeredAsMinor,
    ...events.flatMap((event) =>
      event.competitionId !== null &&
      !registeredAsMinor.has(event.competitionId)
        ? [event.competitionId]
        : []
    ),
  ].filter((id, at, all) => all.indexOf(id) === at);

  const titles = new Map<string, ChildConsentDocument>();
  const competitions = [];
  for (const competitionId of competitionIds) {
    const found = await competitionSetup(ctx.db, competitionId);
    if (!found) continue;
    for (const document of found.documents) titles.set(document.id, document);
    competitions.push({
      id: competitionId,
      title: found.title,
      setup: registeredAsMinor.has(competitionId)
        ? found.setup
        : { ...found.setup, attached: {} },
      minor: true,
    });
  }
  const communications = await latestDocument(ctx.db, "communications");

  const logs = new Map<string, ConsentEventRecord[]>();
  for (const event of events) {
    const key = `${event.competitionId ?? ""}/${event.purpose}`;
    logs.set(key, [...(logs.get(key) ?? []), event]);
  }
  const view = childConsentsView({
    child: {
      ...nameParts(child.fullName),
      fullName: child.fullName,
      schoolName: child.schoolName,
      city: child.city,
    },
    competitions,
    states: (competitionId, purpose) =>
      currentConsent(logs.get(`${competitionId ?? ""}/${purpose}`) ?? [], "id"),
    communicationsDocument: communications,
  });
  const titled = (document: { id: string } | null) =>
    document ? (titles.get(document.id) ?? null) : null;
  return {
    ok: true,
    child: { id: childId, fullName: child.fullName },
    competitions: view.competitions.map((each) => ({
      ...each,
      purposes: each.purposes.map((purpose) => ({
        ...purpose,
        document: titled(purpose.document),
      })),
    })),
    communications: {
      ...view.communications,
      document: communications && {
        id: communications.id,
        version: communications.version,
        title: communications.title,
        body: communications.body,
      },
    },
  };
}

export async function childConsentHistory(
  ctx: UseCaseContext,
  input: { childId: string }
): Promise<ChildConsentHistory | NotVerified> {
  const allowed = await authorizeGuardian(
    ctx,
    "consent.child.read",
    input.childId
  );
  if (!allowed.ok) return allowed;
  const { childId } = childInput.parse(input);
  const child = await childFacts(ctx, childId);
  const events = await childEvents(ctx.db, childId);
  return {
    ok: true,
    child: { id: childId, fullName: child.fullName },
    events: events.flatMap((event): ChildConsentHistoryItem[] =>
      isGuardianPurpose(event.purpose)
        ? [
            {
              id: event.id,
              purpose: event.purpose,
              competition:
                event.competitionId !== null && event.competitionTitle !== null
                  ? { id: event.competitionId, title: event.competitionTitle }
                  : null,
              action: event.action,
              document: {
                id: event.documentId,
                version: event.documentVersion,
                title: event.documentTitle,
              },
              giverName: event.giverName,
              method: event.method,
              occurredAt: event.occurredAt,
            },
          ]
        : []
    ),
  };
}
