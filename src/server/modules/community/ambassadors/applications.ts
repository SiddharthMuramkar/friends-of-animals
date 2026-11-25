import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { emit } from "../../../outbox";
import { invalidInput } from "../../../input";
import { recordEngagement } from "../engagement";
import { AMBASSADOR_STATUSES, AMBASSADOR_TRANSITIONS } from "./domain/status";
import { authorize } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import {
  ambassadorApplication,
  engagementMilestone,
  volunteerApplication,
  user,
  type AmbassadorApplication,
} from "../../../db/schema";
import { DomainError } from "../../../errors";
import { uuidv7 } from "../../../ids";
import type { UseCaseContext } from "../../../use-cases";
import { lockUserSubject } from "../../consent/repository";
import { ageAt } from "../../participants/domain/age";
import { parseIsoDate } from "../../registration/domain/calendar-date";
import { readSetting } from "../../settings/read";
import {
  applicantProfileOf,
  DATE_OF_BIRTH_PURPOSE,
} from "../../volunteers/application-record";
import { belongsTo, communityMemberFor, personKeys } from "../subjects";
import { ambassadorEligibility } from "./domain/eligibility";

import { AMBASSADOR_DECLINE_PURPOSE } from "./fields";

function userId(ctx: UseCaseContext) {
  if (ctx.actor.kind !== "user")
    throw new DomainError("forbidden", "Signed-in applicant required");
  return ctx.actor.userId;
}
async function currentApplication(
  ctx: UseCaseContext,
  applicantUserId: string
) {
  const [row] = await ctx.db
    .select()
    .from(ambassadorApplication)
    .where(eq(ambassadorApplication.applicantUserId, applicantUserId))
    .orderBy(
      sql`CASE WHEN ${ambassadorApplication.status} IN ('submitted','approved') THEN 0 ELSE 1 END`,
      desc(ambassadorApplication.submittedAt),
      desc(ambassadorApplication.id)
    )
    .limit(1);
  return row ?? null;
}

// A participant's stored profile takes precedence over a volunteer application's
// stored DOB. Never accept a new DOB in the ambassador application, and fail
// closed for unknown age. Guardian profiles are not the guardian's own key.
async function ageOf(ctx: UseCaseContext, id: string, now: Date) {
  const profile = await applicantProfileOf(ctx.db, ctx.cipher, id);
  if (profile) return ageAt(profile.dateOfBirth, now);
  const [approved] = await ctx.db
    .select({ dob: volunteerApplication.dateOfBirthCiphertext })
    .from(volunteerApplication)
    .where(
      and(
        eq(volunteerApplication.applicantUserId, id),
        eq(volunteerApplication.status, "approved")
      )
    )
    .orderBy(desc(volunteerApplication.decidedAt))
    .limit(1);
  const dob = approved
    ? parseIsoDate(ctx.cipher.decrypt(DATE_OF_BIRTH_PURPOSE, approved.dob))
    : null;
  return dob ? ageAt(dob, now) : null;
}

async function eligibilityFor(
  ctx: UseCaseContext,
  id: string,
  purpose: "apply" | "approve",
  lock = false
) {
  const now = ctx.clock.now();
  const share = lock ? { lock: "share" as const } : undefined;
  const membership = await communityMemberFor(ctx.db, {
    kind: "user",
    userId: id,
  });
  const milestones = await ctx.db
    .select({ kind: engagementMilestone.kind })
    .from(engagementMilestone)
    .where(belongsTo(await personKeys(ctx.db, id), engagementMilestone));
  const application = await currentApplication(ctx, id);
  return ambassadorEligibility(
    {
      membership,
      ageYears: await ageOf(ctx, id, now),
      milestones: milestones.map(({ kind }) => kind),
      hasOpenApplication: application?.status === "submitted",
    },
    {
      membershipDays: await readSetting(
        ctx.db,
        "ambassadors.minMembershipDays",
        share
      ),
      ageYears: await readSetting(ctx.db, "ambassadors.minAgeYears", share),
      qualifyingMilestones: await readSetting(
        ctx.db,
        "ambassadors.qualifyingMilestones",
        share
      ),
    },
    now,
    purpose
  );
}

function view(ctx: UseCaseContext, row: AmbassadorApplication) {
  return {
    id: row.id,
    status: row.status,
    submittedAt: row.submittedAt,
    decidedAt: row.decidedAt,
    declineReason: row.declineReasonCiphertext
      ? ctx.cipher.decrypt(
          AMBASSADOR_DECLINE_PURPOSE,
          row.declineReasonCiphertext
        )
      : null,
  };
}

export async function getMyAmbassador(ctx: UseCaseContext) {
  await authorize(ctx, "ambassador.read");
  const id = userId(ctx);
  const application = await currentApplication(ctx, id);
  return {
    eligibility: await eligibilityFor(ctx, id, "apply"),
    application: application ? view(ctx, application) : null,
  };
}

export async function applyForAmbassador(ctx: UseCaseContext) {
  const { role } = await authorize(ctx, "ambassador.apply");
  const applicantUserId = userId(ctx);
  return ctx.db.transaction(async (db) => {
    await lockUserSubject(db, applicantUserId);
    const local = { ...ctx, db };
    const eligibility = await eligibilityFor(
      local,
      applicantUserId,
      "apply",
      true
    );
    if (!eligibility.eligible)
      return { ok: false, error: "ineligible" } as const;
    const now = ctx.clock.now();
    const id = uuidv7(now);
    await db
      .insert(ambassadorApplication)
      .values({ id, applicantUserId, status: "submitted", submittedAt: now });
    await recordAudit(db, local, {
      action: "ambassador.application_submitted",
      entity: { type: "ambassador_application", id },
      before: null,
      after: { status: "submitted" },
      actorRole: role,
    });
    await emit(db, ctx.clock, {
      type: "ambassador.application_submitted",
      aggregate: { type: "ambassador_application", id },
      payload: { applicationId: id },
    });
    return { ok: true, applicationId: id } as const;
  });
}

const listInput = z.strictObject({
  status: z.enum(AMBASSADOR_STATUSES).optional(),
  page: z.int().min(1).max(100000).default(1),
});
export type AmbassadorListInput = z.input<typeof listInput>;
const PAGE_SIZE = 25;
export async function listAmbassadorApplications(
  ctx: UseCaseContext,
  input: AmbassadorListInput = {}
) {
  await authorize(ctx, "ambassador.review");
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { status, page } = parsed.data;
  const where = status ? eq(ambassadorApplication.status, status) : undefined;
  const rows = await ctx.db
    .select({ application: ambassadorApplication, applicantName: user.name })
    .from(ambassadorApplication)
    .innerJoin(user, eq(user.id, ambassadorApplication.applicantUserId))
    .where(where)
    .orderBy(
      desc(ambassadorApplication.submittedAt),
      desc(ambassadorApplication.id)
    )
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  const [total] = await ctx.db
    .select({ count: count() })
    .from(ambassadorApplication)
    .where(where);
  const applications = await Promise.all(
    rows.map(async ({ application, applicantName }) => ({
      ...view(ctx, application),
      applicantName,
      eligibility:
        application.status === "submitted"
          ? await eligibilityFor(ctx, application.applicantUserId, "approve")
          : null,
    }))
  );
  return {
    ok: true,
    applications,
    total: total!.count,
    page,
    pageSize: PAGE_SIZE,
  } as const;
}

const decisionInput = z.discriminatedUnion("decision", [
  z.strictObject({ applicationId: z.uuid(), decision: z.literal("approve") }),
  z.strictObject({
    applicationId: z.uuid(),
    decision: z.literal("decline"),
    reason: z.string().trim().min(1).max(1000),
  }),
]);
export type AmbassadorDecisionInput = z.input<typeof decisionInput>;
export async function decideAmbassador(
  ctx: UseCaseContext,
  input: AmbassadorDecisionInput
) {
  await authorize(ctx, "ambassador.decide");
  const parsed = decisionInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { applicationId, decision } = parsed.data;
  const [found] = await ctx.db
    .select({ applicantUserId: ambassadorApplication.applicantUserId })
    .from(ambassadorApplication)
    .where(eq(ambassadorApplication.id, applicationId));
  if (!found) return { ok: false, error: "not_found" } as const;
  return ctx.db.transaction(async (db) => {
    const local = { ...ctx, db };
    const { role } = await authorize(local, "ambassador.decide");
    await lockUserSubject(db, found.applicantUserId);
    const [row] = await db
      .select()
      .from(ambassadorApplication)
      .where(eq(ambassadorApplication.id, applicationId))
      .for("update");
    if (!row) return { ok: false, error: "not_found" } as const;
    if (row.applicantUserId === userId(ctx))
      return { ok: false, error: "self_review" } as const;
    const next =
      row.status === "submitted"
        ? AMBASSADOR_TRANSITIONS[row.status][decision]
        : undefined;
    if (!next) return { ok: false, error: "invalid_transition" } as const;
    if (
      decision === "approve" &&
      !(await eligibilityFor(local, row.applicantUserId, "approve", true))
        .eligible
    )
      return { ok: false, error: "ineligible" } as const;
    const now = ctx.clock.now();
    await db
      .update(ambassadorApplication)
      .set({
        status: next,
        decidedAt: now,
        decidedByUserId: userId(ctx),
        declineReasonCiphertext:
          parsed.data.decision === "decline"
            ? ctx.cipher.encrypt(AMBASSADOR_DECLINE_PURPOSE, parsed.data.reason)
            : null,
      })
      .where(eq(ambassadorApplication.id, applicationId));
    if (next === "approved")
      await recordEngagement(db, local, {
        type: "milestone",
        subject: { kind: "user", userId: row.applicantUserId },
        kind: "ambassador",
        competitionId: null,
        occurredAt: now,
        sourceType: "ambassador_application",
        sourceId: row.id,
      });
    const type =
      next === "approved"
        ? "ambassador.application_approved"
        : "ambassador.application_declined";
    await recordAudit(db, local, {
      action: type,
      entity: { type: "ambassador_application", id: applicationId },
      before: { status: row.status },
      after: { status: next },
      actorRole: role,
    });
    await emit(db, ctx.clock, {
      type,
      aggregate: { type: "ambassador_application", id: applicationId },
      payload: { applicationId },
    });
    return { ok: true } as const;
  });
}
