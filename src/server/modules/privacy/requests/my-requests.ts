// A requester's own privacy requests (#115a).
//
//   listMyPrivacyRequests()          → what I filed, and what my children
//                                      filed or had filed for them
//   getMyPrivacyRequest({ id })      → one of those, with its timeline
//   cancelPrivacyRequest({ id })     → withdraw one I filed, before work
//                                      starts
//
// Whoever filed a request reads it, and so does the verified guardian of
// the child it is about (a teen's own request included). Only whoever
// filed it cancels it. Anyone else is refused as forbidden, whether or not
// the request exists. The grievance officer's notes are never shown here.
//
// Loads under plain Node: relative imports only, no "server-only".

import { desc, eq, inArray, or, and } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import type { Resource } from "../../../access/domain/policy";
import { recordAudit } from "../../../audit/record";
import type { AppDb } from "../../../db/app-db";
import {
  participantProfile,
  privacyRequest,
  type PrivacyRequestRow,
  type RetainedCategory,
} from "../../../db/schema";
import { DomainError } from "../../../errors";
import type { UseCaseContext } from "../../../use-cases";
import { openOrNull } from "./content";
import { privacyRequestAuditSnapshot } from "./domain/audit";
import {
  decideRequestTransition,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
  type RequestTransitionRefusal,
} from "./domain/request-status";
import { exportViewOf, type ExportView } from "./export-view";
import { guardedChildOf, guardedChildren, type GuardedChild } from "./people";
import { lockSubject } from "./submit";

export type RequestAbout =
  | { kind: "self" }
  | { kind: "child"; childId: string; name: string };

export type MyRequestItem = {
  id: string;
  reference: string;
  type: PrivacyRequestType;
  status: PrivacyRequestStatus;
  about: RequestAbout;
  /** False for a teen's own request their guardian is shown. */
  filedByYou: boolean;
  createdAt: Date;
  dueAt: Date;
  closedAt: Date | null;
};

export type MyRequestView = MyRequestItem & {
  startedAt: Date | null;
  correctionDetails: string | null;
  rejectionReason: string | null;
  resolution: string | null;
  /** What an erasure kept, and why. */
  retained: RetainedCategory[] | null;
  /** The data export of an access request, for whoever filed it. */
  export: ExportView;
  canCancel: boolean;
};

const idInput = z.strictObject({ id: z.uuid() });

const ME_ONLY = (userId: string): Resource => ({ ownerId: userId });

function signedInUserId(ctx: Pick<UseCaseContext, "actor">): string {
  if (ctx.actor.kind !== "user") {
    throw new Error("A requester is always a signed-in user");
  }
  return ctx.actor.userId;
}

/** Profile names for the child profiles requests are about. */
async function profileNames(
  db: AppDb,
  rows: readonly PrivacyRequestRow[]
): Promise<Map<string, string>> {
  const ids = rows
    .filter((row) => row.subjectKind === "participant_profile")
    .map((row) => row.subjectId);
  if (ids.length === 0) return new Map();
  const found = await db
    .select({ id: participantProfile.id, name: participantProfile.fullName })
    .from(participantProfile)
    .where(inArray(participantProfile.id, ids));
  return new Map(found.map((row) => [row.id, row.name]));
}

function aboutOf(
  row: PrivacyRequestRow,
  userId: string,
  children: readonly GuardedChild[],
  names: ReadonlyMap<string, string>
): RequestAbout {
  if (row.subjectKind === "user" && row.subjectId === userId) {
    return { kind: "self" };
  }
  const child = guardedChildOf(children, row);
  if (child) {
    return { kind: "child", childId: child.profileId, name: child.name };
  }
  // A child the guardian filed for and no longer looks after (or erased).
  return {
    kind: "child",
    childId: row.subjectId,
    name: names.get(row.subjectId) ?? "",
  };
}

function itemOf(
  row: PrivacyRequestRow,
  userId: string,
  children: readonly GuardedChild[],
  names: ReadonlyMap<string, string>
): MyRequestItem {
  return {
    id: row.id,
    reference: row.reference,
    type: row.type,
    status: row.status,
    about: aboutOf(row, userId, children, names),
    filedByYou: row.requestedByUserId === userId,
    createdAt: row.createdAt,
    dueAt: row.dueAt,
    closedAt: row.closedAt,
  };
}

/** Requests `userId` may read: filed by them, or about a child of theirs. */
function visibleTo(userId: string, children: readonly GuardedChild[]) {
  const profileIds = children.map((child) => child.profileId);
  const loginIds = children
    .map((child) => child.loginUserId)
    .filter((id): id is string => id !== null);
  return or(
    eq(privacyRequest.requestedByUserId, userId),
    profileIds.length > 0
      ? and(
          eq(privacyRequest.subjectKind, "participant_profile"),
          inArray(privacyRequest.subjectId, profileIds)
        )
      : undefined,
    loginIds.length > 0
      ? and(
          eq(privacyRequest.subjectKind, "user"),
          inArray(privacyRequest.subjectId, loginIds)
        )
      : undefined
  );
}

export async function listMyPrivacyRequests(
  ctx: UseCaseContext
): Promise<MyRequestItem[]> {
  await authorize(
    ctx,
    "privacy_request.view_own",
    ctx.actor.kind === "user" ? ME_ONLY(ctx.actor.userId) : {}
  );
  const userId = signedInUserId(ctx);
  const children = await guardedChildren(ctx.db, userId);
  const rows = await ctx.db
    .select()
    .from(privacyRequest)
    .where(visibleTo(userId, children))
    .orderBy(desc(privacyRequest.createdAt), desc(privacyRequest.id))
    .limit(200);
  const names = await profileNames(ctx.db, rows);
  return rows.map((row) => itemOf(row, userId, children, names));
}

/** The request, if `userId` may read it; refused as forbidden otherwise. */
async function readableRequest(
  ctx: UseCaseContext,
  id: unknown,
  action: "privacy_request.view_own" | "privacy_request.cancel"
) {
  const parsed = idInput.safeParse({ id });
  const userId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
  if (!parsed.success || userId === null) {
    await authorize(ctx, action, {});
    throw new DomainError("forbidden", "Not a request this user may read");
  }
  const children = await guardedChildren(ctx.db, userId);
  const [row] = await ctx.db
    .select()
    .from(privacyRequest)
    .where(
      and(eq(privacyRequest.id, parsed.data.id), visibleTo(userId, children))
    );
  const mayAct =
    row !== undefined &&
    (action === "privacy_request.view_own" || row.requestedByUserId === userId);
  await authorize(ctx, action, mayAct ? ME_ONLY(userId) : {});
  if (!row) throw new Error("Authorized a request that isn't there");
  return { row, userId, children };
}

export async function getMyPrivacyRequest(
  ctx: UseCaseContext,
  input: { id: string }
): Promise<MyRequestView> {
  const { row, userId, children } = await readableRequest(
    ctx,
    input?.id,
    "privacy_request.view_own"
  );
  const names = await profileNames(ctx.db, [row]);
  const filedByYou = row.requestedByUserId === userId;
  return {
    ...itemOf(row, userId, children, names),
    startedAt: row.startedAt,
    correctionDetails: openOrNull(
      ctx.cipher,
      "correctionDetails",
      row.correctionDetails
    ),
    rejectionReason: openOrNull(
      ctx.cipher,
      "rejectionReason",
      row.rejectionReason
    ),
    resolution: openOrNull(ctx.cipher, "resolution", row.resolution),
    retained: row.retained,
    export: exportViewOf(row, ctx.clock.now(), filedByYou),
    canCancel: filedByYou && row.status === "submitted",
  };
}

export type CancelPrivacyRequestResult =
  | { ok: true }
  | { ok: false; error: RequestTransitionRefusal };

export async function cancelPrivacyRequest(
  ctx: UseCaseContext,
  input: { id: string }
): Promise<CancelPrivacyRequestResult> {
  const { row: seen } = await readableRequest(
    ctx,
    input?.id,
    "privacy_request.cancel"
  );
  return ctx.db.transaction(async (tx) => {
    await lockSubject(tx, seen.subjectId);
    const [row] = await tx
      .select()
      .from(privacyRequest)
      .where(eq(privacyRequest.id, seen.id))
      .for("update");
    if (!row) throw new Error(`Request ${seen.id} vanished`);
    const decision = decideRequestTransition({
      from: row.status,
      event: "cancel",
      type: row.type,
    });
    if (!decision.ok) return { ok: false, error: decision.reason } as const;
    const now = ctx.clock.now();
    const [updated] = await tx
      .update(privacyRequest)
      .set({ status: decision.to, closedAt: now, updatedAt: now })
      .where(eq(privacyRequest.id, row.id))
      .returning();
    await recordAudit(tx, ctx, {
      action: "privacy_request.cancelled",
      entity: { type: "privacy_request", id: row.id },
      before: privacyRequestAuditSnapshot(row),
      after: privacyRequestAuditSnapshot(updated!),
      actorRole: null,
    });
    return { ok: true } as const;
  });
}
