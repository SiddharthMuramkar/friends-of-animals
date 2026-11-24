// A verified guardian's children (#81):
//
//   addChild({ fullName, dateOfBirth, relationship })  → a profile the
//       guardian owns, linked to them: under 13 managed (no login), 13 to
//       17 linked (an own login comes by invitation, ./teen-login.ts)
//   listChildren()        → every child they look after, as they are today
//   getChild({ childId }) → one child, with any invitation still waiting
//
// Whether a child may be added is the pure decision's to say
// (./domain/children.ts), from the age today on India's calendar. Adding
// writes the profile, the link and the audit entry in one transaction, or
// nothing. A child's details are kept as given and never overwritten by a
// later form: there is no later form in this unit.

import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { authorize, can } from "../../access/can";
import { recordAudit } from "../../audit/record";
import {
  guardian,
  guardianLink,
  participantProfile,
  user,
} from "../../db/schema";
import { DomainError } from "../../errors";
import { monotonicUuidv7, uuidv7 } from "../../ids";
import type { InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { ageAt, parseDateOfBirth } from "../participants/domain/age";
import { formatIsoDate } from "../registration/domain/calendar-date";
import { identityKeyInput } from "../registration/domain/identity-key";
import { IDENTITY_HASH_PURPOSE } from "../registration/domain/prepare-student";
import { GUARDIAN_RELATIONSHIPS } from "../registration/domain/student-details";
import { PROFILE_PURPOSE } from "../registration/student-profile";
import { activeLinkOf, childResource } from "./child-access";
import {
  CHILD_COLUMNS,
  viewChildren,
  type ChildDetail,
  type ChildSummary,
} from "./child-view";
import {
  decideAddChild,
  type AddChildRefusal,
  type ChildKind,
} from "./domain/children";
import { guardianFlowsActive } from "./availability";
import { guardianOfUser } from "./guardian-record";

export type AddChildInput = {
  fullName: string;
  /** `YYYY-MM-DD`, as `<input type="date">` submits it. */
  dateOfBirth: string;
  /**
   * One of GUARDIAN_RELATIONSHIPS, as the form submits it; anything else
   * comes back as invalid input.
   */
  relationship: string;
};

export type AddChildResult =
  | { ok: true; childId: string; kind: ChildKind }
  | InvalidInput
  | { ok: false; error: AddChildRefusal | "already_added" | "unavailable" };

export type GetChildResult = { ok: true; child: ChildDetail };

/**
 * Children added in one millisecond still list in the order they were
 * added (by id, after the instant).
 */
const nextChildId = monotonicUuidv7();

const addChildInput = z.object({
  fullName: z.string().trim().min(1).max(100),
  dateOfBirth: z.string().max(32),
  relationship: z.enum(GUARDIAN_RELATIONSHIPS),
});

function forbidden(ctx: UseCaseContext, action: string): never {
  throw new DomainError("forbidden", `${ctx.actor.kind} may not ${action}`);
}

/**
 * Authorizes managing children; a member who has declared but not yet
 * verified is told so rather than refused outright.
 */
async function authorizeChildren(
  ctx: UseCaseContext
): Promise<
  | { ok: true; userId: string; role: "guardian" | null }
  | { ok: false; error: "guardian_not_verified" }
> {
  const decision = await can(ctx, "guardian.children.manage");
  if (decision.allowed && ctx.actor.kind === "user") {
    return {
      ok: true,
      userId: ctx.actor.userId,
      role: decision.role === "guardian" ? "guardian" : null,
    };
  }
  if (ctx.actor.kind === "user") {
    const record = await guardianOfUser(ctx.db, ctx.actor.userId);
    if (record && !record.verifiedAt) {
      return { ok: false, error: "guardian_not_verified" };
    }
  }
  return forbidden(ctx, "guardian.children.manage");
}

export async function addChild(
  ctx: UseCaseContext,
  input: AddChildInput
): Promise<AddChildResult> {
  const allowed = await authorizeChildren(ctx);
  if (!allowed.ok) return allowed;
  if (!guardianFlowsActive(ctx.appEnv)) {
    return { ok: false, error: "unavailable" };
  }
  const { userId, role: actorRole } = allowed;
  const parsed = addChildInput.safeParse(input);
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((i) => String(i.path[0])));
    return {
      ok: false,
      error: "invalid_input",
      fields: ["fullName", "dateOfBirth", "relationship"].filter((field) =>
        fields.has(field)
      ),
    };
  }
  const { fullName, relationship } = parsed.data;
  const now = ctx.clock.now();
  const dateOfBirth = parseDateOfBirth(parsed.data.dateOfBirth.trim(), now);

  return ctx.db.transaction(async (tx): Promise<AddChildResult> => {
    // One guardian's additions take turns, so the duplicate check sees
    // every earlier child.
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("no key update");
    const record = await guardianOfUser(tx, userId);
    if (!record) forbidden(ctx, "guardian.children.manage");
    const decision = decideAddChild({
      guardianVerified: record.verifiedAt !== null,
      ageYears: dateOfBirth === null ? null : ageAt(dateOfBirth, now),
    });
    if (!decision.ok) return { ok: false, error: decision.reason };
    if (dateOfBirth === null) throw new Error("unreachable");

    const identityHash = ctx.blindIndex.of(
      IDENTITY_HASH_PURPOSE,
      identityKeyInput(fullName, dateOfBirth)
    );
    const [already] = await tx
      .select({ id: participantProfile.id })
      .from(participantProfile)
      .where(
        and(
          eq(participantProfile.ownerUserId, userId),
          eq(participantProfile.ownerKind, "guardian"),
          eq(participantProfile.identityHash, identityHash)
        )
      );
    if (already) return { ok: false, error: "already_added" };

    const childId = nextChildId(now);
    await tx.insert(participantProfile).values({
      id: childId,
      ownerKind: "guardian",
      ownerUserId: userId,
      fullName,
      dobCiphertext: ctx.cipher.encrypt(
        PROFILE_PURPOSE.dob,
        formatIsoDate(dateOfBirth)
      ),
      identityHash,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(guardianLink).values({
      id: uuidv7(now),
      guardianId: record.id,
      participantProfileId: childId,
      relationship,
      createdAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "guardian.child_added",
      entity: { type: "participant_profile", id: childId },
      before: null,
      after: { guardianId: record.id, kind: decision.kind, relationship },
      actorRole,
    });
    return { ok: true, childId, kind: decision.kind };
  });
}

/** The children `userId` looks after through an active link, oldest first. */
function childrenOf(ctx: UseCaseContext, userId: string) {
  return ctx.db
    .select({ ...CHILD_COLUMNS, relationship: guardianLink.relationship })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, guardianLink.participantProfileId)
    )
    .where(and(eq(guardian.userId, userId), isNull(guardianLink.revokedAt)))
    .orderBy(asc(participantProfile.createdAt), asc(participantProfile.id));
}

export async function listChildren(
  ctx: UseCaseContext
): Promise<ChildSummary[]> {
  await authorize(ctx, "guardian.children.manage");
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const rows = await childrenOf(ctx, ctx.actor.userId);
  const children = await viewChildren(ctx, rows, ctx.clock.now());
  return children.map(({ invitation: _invitation, ...child }) => child);
}

export async function getChild(
  ctx: UseCaseContext,
  input: { childId: string }
): Promise<GetChildResult> {
  await authorize(
    ctx,
    "guardian.child.manage",
    await childResource(ctx.db, ctx.actor, input.childId)
  );
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const [row] = await ctx.db
    .select({ ...CHILD_COLUMNS, relationship: guardianLink.relationship })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, guardianLink.participantProfileId)
    )
    .where(activeLinkOf(ctx.actor.userId, input.childId));
  if (!row) forbidden(ctx, "guardian.child.manage");
  const [child] = await viewChildren(ctx, [row], ctx.clock.now());
  return { ok: true, child: child! };
}
