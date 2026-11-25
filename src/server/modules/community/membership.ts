import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { emit } from "../../outbox";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  communityMember,
  guardian,
  guardianLink,
  participantProfile,
  type CommunityMemberRow,
} from "../../db/schema";
import { DomainError } from "../../errors";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { verifiedLink } from "../guardians/child-access";
import {
  memberProfileSchema,
  decideJoin,
  decideLeave,
} from "./domain/membership";
import type { Subject } from "./domain/subject";
import { recordEngagement } from "./engagement";
import { communityMemberFor, lockPerson, subjectColumns } from "./subjects";

import { COMMUNITY_MEMBER_PURPOSE } from "./profile-fields";

export type TargetInput = { childId?: string };
const targetSchema = z.strictObject({ childId: z.uuid().optional() });
const profileInput = memberProfileSchema.extend({
  childId: z.uuid().optional(),
});
export type MemberProfileInput = z.input<typeof profileInput>;

/** Resolves the actor's own subject or a live, verified linked child; no
 * arbitrary user selector. For a guardian mutation a teen joins directly. */
export async function targetSubject(
  ctx: UseCaseContext,
  input: TargetInput,
  mode: "read" | "write" = "read"
): Promise<Subject> {
  await authorize(ctx, "community.timeline.read");
  if (ctx.actor.kind !== "user")
    throw new DomainError("forbidden", "A signed-in person is required");
  if (input.childId === undefined)
    return { kind: "user", userId: ctx.actor.userId };
  if (!z.uuid().safeParse(input.childId).success)
    throw new DomainError("forbidden", "Child access refused");
  const query = ctx.db
    .select({
      id: guardianLink.id,
      loginUserId: participantProfile.loginUserId,
      ownerKind: participantProfile.ownerKind,
      ownerUserId: participantProfile.ownerUserId,
    })
    .from(guardianLink)
    .innerJoin(guardian, eq(guardian.id, guardianLink.guardianId))
    .innerJoin(
      participantProfile,
      eq(participantProfile.id, guardianLink.participantProfileId)
    )
    .where(
      and(
        eq(guardian.userId, ctx.actor.userId),
        eq(guardianLink.participantProfileId, input.childId),
        verifiedLink()
      )
    );
  // Keep the live link through a write so revocation cannot race the decision.
  const [link] =
    mode === "write"
      ? await query.for("no key update", { of: guardianLink })
      : await query;
  await authorize(
    ctx,
    "community.child.read",
    link ? { ownerId: ctx.actor.userId } : {}
  );
  return { kind: "profile", profileId: input.childId };
}

export function memberView(
  ctx: Pick<UseCaseContext, "cipher">,
  row: CommunityMemberRow
) {
  return {
    id: row.id,
    status: row.status,
    joinedAt: row.joinedAt,
    leftAt: row.leftAt,
    displayName: row.displayNameCiphertext
      ? ctx.cipher.decrypt(
          COMMUNITY_MEMBER_PURPOSE.displayName,
          row.displayNameCiphertext
        )
      : null,
    about: row.aboutCiphertext
      ? ctx.cipher.decrypt(COMMUNITY_MEMBER_PURPOSE.about, row.aboutCiphertext)
      : null,
  };
}

export async function getMyCommunity(
  ctx: UseCaseContext,
  input: TargetInput = {}
) {
  const subject = await targetSubject(ctx, input);
  const row = await communityMemberFor(ctx.db, subject);
  const canonical = row ? memberView(ctx, row) : null;
  const [profile] =
    subject.kind === "profile"
      ? await ctx.db
          .select({
            loginUserId: participantProfile.loginUserId,
            ownerKind: participantProfile.ownerKind,
            ownerUserId: participantProfile.ownerUserId,
          })
          .from(participantProfile)
          .where(eq(participantProfile.id, subject.profileId))
      : [];
  return {
    member: canonical,
    canManage:
      !profile?.loginUserId &&
      !(profile?.ownerKind === "self" && profile.ownerUserId),
  };
}

function encryptedProfile(
  ctx: UseCaseContext,
  profile: z.output<typeof profileInput>
) {
  return {
    displayNameCiphertext: ctx.cipher.encrypt(
      COMMUNITY_MEMBER_PURPOSE.displayName,
      profile.displayName
    ),
    aboutCiphertext: profile.about
      ? ctx.cipher.encrypt(COMMUNITY_MEMBER_PURPOSE.about, profile.about)
      : null,
  };
}

async function childHasLogin(db: AppDb, subject: Subject) {
  if (subject.kind === "user") return false;
  const [p] = await db
    .select({
      loginUserId: participantProfile.loginUserId,
      ownerKind: participantProfile.ownerKind,
      ownerUserId: participantProfile.ownerUserId,
    })
    .from(participantProfile)
    .where(eq(participantProfile.id, subject.profileId));
  return Boolean(p?.loginUserId || (p?.ownerKind === "self" && p.ownerUserId));
}

export async function joinCommunity(
  ctx: UseCaseContext,
  input: MemberProfileInput
) {
  const { role } = await authorize(ctx, "community.join");
  const parsed = profileInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (db) => {
    const local = { ...ctx, db };
    const subject = await targetSubject(local, parsed.data);
    const key = await lockPerson(db, subject);
    await targetSubject(local, parsed.data, "write");
    const current = await communityMemberFor(db, subject);
    const decision = decideJoin(
      subject.kind === "profile"
        ? {
            target: "child",
            linkedGuardian: true,
            childHasOwnLogin: await childHasLogin(db, subject),
          }
        : { target: "self" },
      current?.status ?? null
    );
    if (!decision.ok) return { ok: false, error: decision.reason } as const;
    if (ctx.actor.kind !== "user")
      throw new DomainError("forbidden", "Member required");
    const now = ctx.clock.now();
    const id = current?.id ?? uuidv7(now);
    const values = {
      ...encryptedProfile(ctx, parsed.data),
      status: "active" as const,
      leftAt: null,
      updatedAt: now,
    };
    if (current) {
      await db
        .update(communityMember)
        .set(values)
        .where(eq(communityMember.id, id));
    } else {
      await db.insert(communityMember).values({
        id,
        ...subjectColumns(key),
        ...values,
        joinedByUserId: ctx.actor.userId,
        joinedAt: now,
        createdAt: now,
      });
    }
    await recordEngagement(db, local, {
      type: "milestone",
      subject: key,
      kind: "community_member",
      competitionId: null,
      occurredAt: now,
      sourceType: "community_member",
      sourceId: id,
    });
    await recordAudit(db, local, {
      action: "community.member_joined",
      entity: { type: "community_member", id },
      before: { status: current?.status ?? null },
      after: { status: "active" },
      actorRole: role,
    });
    await emit(db, ctx.clock, {
      type: "community.member_joined",
      aggregate: { type: "community_member", id },
      payload: { memberId: id },
    });
    return { ok: true, memberId: id } as const;
  });
}

export async function updateMemberProfile(
  ctx: UseCaseContext,
  input: MemberProfileInput
) {
  const { role } = await authorize(ctx, "community.profile.update");
  const parsed = profileInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (db) => {
    const local = { ...ctx, db };
    const subject = await targetSubject(local, parsed.data);
    await lockPerson(db, subject);
    await targetSubject(local, parsed.data, "write");
    if (await childHasLogin(db, subject))
      return { ok: false, error: "child_joins_themselves" } as const;
    const row = await communityMemberFor(db, subject);
    if (row?.status !== "active")
      return { ok: false, error: "not_member" } as const;
    await db
      .update(communityMember)
      .set({
        ...encryptedProfile(ctx, parsed.data),
        updatedAt: ctx.clock.now(),
      })
      .where(eq(communityMember.id, row.id));
    await recordAudit(db, local, {
      action: "community.profile_updated",
      entity: { type: "community_member", id: row.id },
      before: null,
      after: { fields: ["display_name", "about"] },
      actorRole: role,
    });
    return { ok: true, memberId: row.id } as const;
  });
}

export async function leaveCommunity(
  ctx: UseCaseContext,
  input: TargetInput = {}
) {
  const { role } = await authorize(ctx, "community.leave");
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (db) => {
    const local = { ...ctx, db };
    const subject = await targetSubject(local, parsed.data);
    await lockPerson(db, subject);
    await targetSubject(local, parsed.data, "write");
    if (await childHasLogin(db, subject))
      return { ok: false, error: "child_joins_themselves" } as const;
    const row = await communityMemberFor(db, subject);
    if (!decideLeave(row?.status ?? null).ok || !row)
      return { ok: false, error: "not_member" } as const;
    const now = ctx.clock.now();
    await db
      .update(communityMember)
      .set({ status: "left", leftAt: now, updatedAt: now })
      .where(eq(communityMember.id, row.id));
    await recordAudit(db, local, {
      action: "community.member_left",
      entity: { type: "community_member", id: row.id },
      before: { status: "active" },
      after: { status: "left" },
      actorRole: role,
    });
    return { ok: true, memberId: row.id } as const;
  });
}
