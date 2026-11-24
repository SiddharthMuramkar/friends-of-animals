// Moving a volunteer application along (#123).
//
//   decideAsGuardian({ applicationId, decision })   → the teen's verified guardian
//   withdrawVolunteerApplication({ applicationId }) → the applicant or that guardian
//   approveVolunteer({ applicationId })             → a community manager, step-up
//   declineVolunteer({ applicationId, reason })     → a community manager
//
// Each locks the application, checks the actor again against what it
// finds, and moves it by the transition table (./domain/application-
// status.ts), so two decisions at once can't both land. Approval also
// needs both declarations on their current versions, records the consent
// events it rested on and grants the global volunteer role in the same
// transaction.
//
// Loads under plain Node: relative imports only.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { grantGlobalRole } from "../../access/flow-grant";
import type { Role } from "../../access/domain/roles";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  volunteerApplication,
  type VolunteerApplication,
} from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import { emit } from "../../outbox";
import type { UseCaseContext } from "../../use-cases";
import { lockUserSubject } from "../consent/repository";
import { guardianResource, withdrawerResource } from "./access";
import { DECLINE_REASON_PURPOSE, lockApplication } from "./application-record";
import { declineReasonSchema } from "./domain/application-input";
import {
  isOpenVolunteerApplication,
  transitionVolunteerApplication,
  type VolunteerApplicationEvent,
  type VolunteerApplicationStatus,
} from "./domain/application-status";
import {
  decideVolunteerApproval,
  type VolunteerApprovalRefusal,
} from "./domain/approval";
import { declarationStates } from "./declarations";

type Refusal = "not_found" | "invalid_transition";

const applicationIdInput = z.object({ applicationId: z.uuid() });

/** The application, unlocked, for the first authorization check. */
async function findApplication(db: AppDb, applicationId: unknown) {
  if (!z.uuid().safeParse(applicationId).success) return null;
  const [row] = await db
    .select()
    .from(volunteerApplication)
    .where(eq(volunteerApplication.id, applicationId as string));
  return row ?? null;
}

/**
 * Moves the locked application by `event` and stamps what the move
 * records, with its audit entry. Returns the new status, or why not.
 */
async function move(
  tx: AppDb,
  ctx: UseCaseContext,
  row: VolunteerApplication,
  event: VolunteerApplicationEvent,
  audit: { action: string; actorRole: Role | null; after?: object },
  stamp: Partial<typeof volunteerApplication.$inferInsert> = {}
): Promise<
  { ok: true; to: VolunteerApplicationStatus } | { ok: false; error: Refusal }
> {
  const moved = transitionVolunteerApplication(row.status, event);
  if (!moved.ok) return { ok: false, error: "invalid_transition" };
  const now = ctx.clock.now();
  await tx
    .update(volunteerApplication)
    .set({
      ...stamp,
      status: moved.to,
      closedAt: isOpenVolunteerApplication(moved.to) ? null : now,
      updatedAt: now,
    })
    .where(eq(volunteerApplication.id, row.id));
  await recordAudit(tx, ctx, {
    action: audit.action,
    entity: { type: "volunteer_application", id: row.id },
    before: { status: row.status },
    after: { status: moved.to, ...audit.after },
    actorRole: audit.actorRole,
  });
  return { ok: true, to: moved.to };
}

export type DecideAsGuardianResult =
  | { ok: true; status: "submitted" | "guardian_declined" }
  | InvalidInput
  | { ok: false; error: Refusal };

const guardianDecisionInput = z.object({
  applicationId: z.uuid(),
  decision: z.enum(["approve", "decline"]),
});

/**
 * The teen's verified guardian approves (the application goes to a
 * community manager) or declines (it closes). Their approval is the
 * parental consent to the teen volunteering.
 */
export async function decideAsGuardian(
  ctx: UseCaseContext,
  input: { applicationId: string; decision: "approve" | "decline" }
): Promise<DecideAsGuardianResult> {
  const found = await findApplication(ctx.db, input.applicationId);
  await authorize(
    ctx,
    "volunteer.guardian_decide",
    await guardianResource(ctx.db, ctx.actor, found)
  );
  const parsed = guardianDecisionInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { applicationId, decision } = parsed.data;

  return ctx.db.transaction(async (tx) => {
    const row = await lockApplication(tx, applicationId);
    if (!row) return { ok: false, error: "not_found" } as const;
    // Again under the lock: a link revoked since the first check counts.
    const { role } = await authorize(
      { db: tx, clock: ctx.clock, actor: ctx.actor },
      "volunteer.guardian_decide",
      await guardianResource(tx, ctx.actor, row)
    );
    const userId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    const now = ctx.clock.now();
    const moved = await move(
      tx,
      ctx,
      row,
      decision === "approve" ? "guardian_approve" : "guardian_decline",
      { action: "volunteer.guardian_decided", actorRole: role, after: { decision } },
      { guardianUserId: userId, guardianDecidedAt: now }
    );
    if (!moved.ok) return moved;
    if (moved.to === "submitted") {
      await emit(tx, ctx.clock, {
        type: "volunteer.application_submitted",
        aggregate: { type: "volunteer_application", id: row.id },
        payload: { applicationId: row.id },
      });
    }
    return {
      ok: true,
      status: moved.to as "submitted" | "guardian_declined",
    } as const;
  });
}

export type WithdrawVolunteerApplicationResult =
  | { ok: true }
  | InvalidInput
  | { ok: false; error: Refusal };

/** The applicant, or their verified guardian, takes an open application back. */
export async function withdrawVolunteerApplication(
  ctx: UseCaseContext,
  input: { applicationId: string }
): Promise<WithdrawVolunteerApplicationResult> {
  const found = await findApplication(ctx.db, input.applicationId);
  await authorize(
    ctx,
    "volunteer.withdraw",
    (await withdrawerResource(ctx.db, ctx.actor, found)).resource
  );
  const parsed = applicationIdInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  return ctx.db.transaction(async (tx) => {
    const row = await lockApplication(tx, parsed.data.applicationId);
    if (!row) return { ok: false, error: "not_found" } as const;
    const { resource, by } = await withdrawerResource(tx, ctx.actor, row);
    const { role } = await authorize(
      { db: tx, clock: ctx.clock, actor: ctx.actor },
      "volunteer.withdraw",
      resource
    );
    const moved = await move(tx, ctx, row, "withdraw", {
      action: "volunteer.application_withdrawn",
      actorRole: role,
      after: { by },
    });
    return moved.ok ? ({ ok: true } as const) : moved;
  });
}

export type ApproveVolunteerResult =
  | { ok: true }
  | InvalidInput
  | { ok: false; error: "not_found" | VolunteerApprovalRefusal };

/**
 * A community manager approves a submitted application. Both declarations
 * must be given on their current versions; the application records the
 * consent events, and the applicant gets the global volunteer role.
 */
export async function approveVolunteer(
  ctx: UseCaseContext,
  input: { applicationId: string }
): Promise<ApproveVolunteerResult> {
  await authorize(ctx, "volunteer.approve");
  const parsed = applicationIdInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const found = await findApplication(ctx.db, parsed.data.applicationId);
  if (!found) return { ok: false, error: "not_found" };

  return ctx.db.transaction(async (tx) => {
    // The applicant's row first, as every role change and declaration
    // takes it, then the application.
    await lockUserSubject(tx, found.applicantUserId);
    const row = await lockApplication(tx, found.id);
    if (!row) return { ok: false, error: "not_found" } as const;
    const { role } = await authorize(
      { db: tx, clock: ctx.clock, actor: ctx.actor },
      "volunteer.approve"
    );
    const states = await declarationStates(tx, row.applicantUserId);
    const decision = decideVolunteerApproval({
      status: row.status,
      safeguardingDeclaration: states.safeguarding,
      codeOfConduct: states.conduct,
    });
    if (!decision.ok) return { ok: false, error: decision.reason } as const;
    const now = ctx.clock.now();
    const moved = await move(
      tx,
      ctx,
      row,
      "approve",
      {
        action: "volunteer.application_approved",
        actorRole: role,
        after: {
          safeguardingConsentId: decision.safeguardingConsentId,
          conductConsentId: decision.conductConsentId,
        },
      },
      {
        safeguardingConsentId: decision.safeguardingConsentId,
        conductConsentId: decision.conductConsentId,
        decidedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        decidedAt: now,
      }
    );
    if (!moved.ok) throw new Error("The approval check allowed a refused move");
    await grantGlobalRole(tx, ctx, row.applicantUserId, "volunteer", {
      actorRole: role,
    });
    await emit(tx, ctx.clock, {
      type: "volunteer.application_approved",
      aggregate: { type: "volunteer_application", id: row.id },
      payload: { applicationId: row.id },
    });
    return { ok: true } as const;
  });
}

export type DeclineVolunteerResult =
  | { ok: true }
  | InvalidInput
  | { ok: false; error: Refusal };

const declineInput = z.object({
  applicationId: z.uuid(),
  reason: declineReasonSchema,
});

/** A community manager declines a submitted application, saying why. */
export async function declineVolunteer(
  ctx: UseCaseContext,
  input: { applicationId: string; reason: string }
): Promise<DeclineVolunteerResult> {
  await authorize(ctx, "volunteer.decline");
  const parsed = declineInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { applicationId, reason } = parsed.data;

  return ctx.db.transaction(async (tx) => {
    const row = await lockApplication(tx, applicationId);
    if (!row) return { ok: false, error: "not_found" } as const;
    const { role } = await authorize(
      { db: tx, clock: ctx.clock, actor: ctx.actor },
      "volunteer.decline"
    );
    const moved = await move(
      tx,
      ctx,
      row,
      "decline",
      // The reason stays out of the audit log: it is in the row, encrypted.
      { action: "volunteer.application_declined", actorRole: role },
      {
        declineReasonCiphertext: ctx.cipher.encrypt(
          DECLINE_REASON_PURPOSE,
          reason
        ),
        decidedByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        decidedAt: ctx.clock.now(),
      }
    );
    if (!moved.ok) return moved;
    await emit(tx, ctx.clock, {
      type: "volunteer.application_declined",
      aggregate: { type: "volunteer_application", id: row.id },
      payload: { applicationId: row.id },
    });
    return { ok: true } as const;
  });
}
