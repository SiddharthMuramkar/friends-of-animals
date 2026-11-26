import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { grantsOf } from "../../access/grants";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  user,
  userRole,
  volunteerTask,
  volunteerTaskAssignment,
  volunteerHoursEntry,
  volunteerApplication,
  participantProfile,
} from "../../db/schema";
import { DomainError } from "../../errors";
import { emit } from "../../outbox";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { recordEngagement } from "../community";
import { lockSubject } from "../privacy/requests/submit";
import { lockUserSubject } from "../consent/repository";
import { isVerifiedGuardianOf } from "./access";
import {
  approvedMinutes,
  checkHoursDecision,
  checkHoursEntry,
  hoursApprovedSourceKey,
  istDate,
  minutesLoggedOn,
} from "./domain/hours";
import {
  nextTaskStatus,
  TaskTransitionError,
  type TaskAction,
} from "./domain/task-status";

import { WORK_PURPOSES } from "./work-fields";
const forbidden = () =>
  new DomainError("forbidden", "Volunteer work access denied");
const transition = { ok: false, error: "invalid_transition" } as const;
const idSchema = z.uuid();
const taskInput = z.object({
  title: z.string().trim().min(1).max(150),
  description: z.string().trim().min(1).max(2000),
});
const actorId = (ctx: UseCaseContext) => {
  if (ctx.actor.kind !== "user") throw forbidden();
  return ctx.actor.userId;
};
const active = (taskId: string, uid?: string) =>
  and(
    eq(volunteerTaskAssignment.taskId, taskId),
    isNull(volunteerTaskAssignment.unassignedAt),
    uid ? eq(volunteerTaskAssignment.volunteerUserId, uid) : undefined
  );
const taskView = (
  ctx: UseCaseContext,
  row: typeof volunteerTask.$inferSelect
) => ({
  id: row.id,
  status: row.status,
  title: ctx.cipher.decrypt(WORK_PURPOSES.title, row.titleCiphertext),
  description: ctx.cipher.decrypt(
    WORK_PURPOSES.description,
    row.descriptionCiphertext
  ),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
async function isVolunteer(db: AppDb, uid: string) {
  return (await grantsOf(db, uid)).some(
    (g) => g.role === "volunteer" && g.scope.type === "global"
  );
}
// All writes involving a service record queue behind erasure and one another,
// then read the current grant; this also serializes daily limits and snapshots.
export async function lockVolunteer(db: AppDb, uid: string) {
  await lockSubject(db, uid);
  await lockUserSubject(db, uid);
}
export async function createVolunteerTask(
  ctx: UseCaseContext,
  input: z.input<typeof taskInput>
) {
  await authorize(ctx, "volunteer.work.manage");
  const p = taskInput.safeParse(input);
  if (!p.success) return invalidInput(p.error);
  return ctx.db.transaction(async (tx) => {
    const { role } = await authorize(
      { ...ctx, db: tx },
      "volunteer.work.manage"
    );
    const now = ctx.clock.now(),
      id = uuidv7(now);
    await tx.insert(volunteerTask).values({
      id,
      titleCiphertext: ctx.cipher.encrypt(WORK_PURPOSES.title, p.data.title),
      descriptionCiphertext: ctx.cipher.encrypt(
        WORK_PURPOSES.description,
        p.data.description
      ),
      status: nextTaskStatus(null, "create", { remainingAssignees: 0 }),
      createdByUserId: actorId(ctx),
      createdAt: now,
      updatedAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "volunteer.task_created",
      entity: { type: "volunteer_task", id },
      before: null,
      after: { status: "draft" },
      actorRole: role,
    });
    return { ok: true, taskId: id } as const;
  });
}
export async function changeVolunteerTask(
  ctx: UseCaseContext,
  action: Exclude<TaskAction, "create">,
  input: { taskId: string; volunteerUserId?: string }
) {
  const work = action === "start" || action === "complete";
  if (!work) await authorize(ctx, "volunteer.work.manage");
  if (
    !idSchema.safeParse(input.taskId).success ||
    ((action === "assign" || action === "unassign") &&
      !idSchema.safeParse(input.volunteerUserId).success)
  )
    throw forbidden();
  return ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx };
    const uid = input.volunteerUserId;
    if (action === "assign" || action === "unassign")
      await lockVolunteer(tx, uid!);
    const [task] = await tx
      .select()
      .from(volunteerTask)
      .where(eq(volunteerTask.id, input.taskId))
      .for("update");
    const assignments = await tx
      .select()
      .from(volunteerTaskAssignment)
      .where(active(input.taskId));
    const actingUserId = ctx.actor.kind === "user" ? ctx.actor.userId : null;
    const own = assignments.some((a) => a.volunteerUserId === actingUserId);
    const { role } = await authorize(
      c,
      work ? "volunteer.work.transition" : "volunteer.work.manage",
      { ownerId: own ? actorId(ctx) : undefined }
    );
    if (!task) throw forbidden();
    const assignment = assignments.find((a) => a.volunteerUserId === uid);
    if (action === "assign" && !(await isVolunteer(tx, uid!)))
      return { ok: false, error: "not_volunteer" } as const;
    if (action === "unassign" && !assignment)
      return { ok: false, error: "not_assigned" } as const;
    const count =
      assignments.length +
      (action === "assign" && !assignment ? 1 : action === "unassign" ? -1 : 0);
    let status;
    try {
      status = nextTaskStatus(task.status, action, {
        remainingAssignees: count,
      });
    } catch (e) {
      if (e instanceof TaskTransitionError) return transition;
      throw e;
    }
    if (action === "assign" && assignment)
      return { ok: true, taskId: task.id } as const;
    const now = ctx.clock.now();
    if (action === "assign") {
      const assignmentId = uuidv7(now);
      await tx.insert(volunteerTaskAssignment).values({
        id: assignmentId,
        taskId: task.id,
        volunteerUserId: uid!,
        assignedByUserId: actorId(ctx),
        assignedAt: now,
      });
      await emit(tx, ctx.clock, {
        type: "volunteer.task_assigned",
        aggregate: { type: "volunteer_task_assignment", id: assignmentId },
        payload: { assignmentId },
      });
    }
    if (action === "unassign")
      await tx
        .update(volunteerTaskAssignment)
        .set({ unassignedAt: now })
        .where(eq(volunteerTaskAssignment.id, assignment!.id));
    await tx
      .update(volunteerTask)
      .set({ status, updatedAt: now })
      .where(eq(volunteerTask.id, task.id));
    await recordAudit(tx, ctx, {
      action: `volunteer.task_${action}`,
      entity: { type: "volunteer_task", id: task.id },
      before: { status: task.status },
      after: { status, ...(uid ? { volunteerUserId: uid } : {}) },
      actorRole: role,
    });
    return { ok: true, taskId: task.id } as const;
  });
}
export async function listVolunteerTasks(ctx: UseCaseContext) {
  await authorize(ctx, "volunteer.work.manage");
  const tasks = await ctx.db
    .select()
    .from(volunteerTask)
    .orderBy(desc(volunteerTask.createdAt), asc(volunteerTask.id));
  const assignments = await ctx.db
    .select({
      taskId: volunteerTaskAssignment.taskId,
      volunteerUserId: volunteerTaskAssignment.volunteerUserId,
      name: user.name,
      assignedAt: volunteerTaskAssignment.assignedAt,
    })
    .from(volunteerTaskAssignment)
    .innerJoin(user, eq(user.id, volunteerTaskAssignment.volunteerUserId))
    .where(isNull(volunteerTaskAssignment.unassignedAt));
  const volunteers = await ctx.db
    .selectDistinct({ id: user.id, name: user.name })
    .from(user)
    .innerJoin(userRole, eq(userRole.userId, user.id))
    .where(
      and(eq(userRole.role, "volunteer"), eq(userRole.scopeType, "global"))
    )
    .orderBy(asc(user.name));
  return {
    tasks: tasks.map((t) => ({
      ...taskView(ctx, t),
      assignments: assignments.filter((a) => a.taskId === t.id),
    })),
    volunteers,
  };
}
export async function entriesFor(db: AppDb, uid: string) {
  return db
    .select({
      entry: volunteerHoursEntry,
      assignment: volunteerTaskAssignment,
      task: volunteerTask,
    })
    .from(volunteerHoursEntry)
    .innerJoin(
      volunteerTaskAssignment,
      eq(volunteerTaskAssignment.id, volunteerHoursEntry.assignmentId)
    )
    .innerJoin(
      volunteerTask,
      eq(volunteerTask.id, volunteerTaskAssignment.taskId)
    )
    .where(eq(volunteerTaskAssignment.volunteerUserId, uid))
    .orderBy(
      desc(volunteerHoursEntry.workedOn),
      desc(volunteerHoursEntry.createdAt)
    );
}
const hoursInput = z.object({
  taskId: z.uuid(),
  minutes: z.number().int().min(1).max(1440),
  workedOn: z.string().length(10),
  note: z.string().max(500).optional(),
});
export async function logVolunteerHours(
  ctx: UseCaseContext,
  input: z.input<typeof hoursInput>
) {
  await authorize(ctx, "volunteer.work.own");
  const p = hoursInput.safeParse(input);
  if (!p.success) return invalidInput(p.error);
  const uid = actorId(ctx);
  return ctx.db.transaction(async (tx) => {
    await lockVolunteer(tx, uid);
    const { role } = await authorize({ ...ctx, db: tx }, "volunteer.work.own");
    const [task] = await tx
      .select()
      .from(volunteerTask)
      .where(eq(volunteerTask.id, p.data.taskId))
      .for("update");
    const assignments = await tx
      .select()
      .from(volunteerTaskAssignment)
      .where(
        and(
          eq(volunteerTaskAssignment.taskId, p.data.taskId),
          eq(volunteerTaskAssignment.volunteerUserId, uid)
        )
      )
      .orderBy(desc(volunteerTaskAssignment.assignedAt));
    if (!task || !assignments.length) throw forbidden();
    // Reassignment must not prevent logging work from an earlier genuine
    // interval. Prefer the active interval when two overlap on one IST day.
    const assignment =
      assignments.find(
        (a) =>
          a.unassignedAt === null && p.data.workedOn >= istDate(a.assignedAt)
      ) ??
      assignments.find(
        (a) =>
          p.data.workedOn >= istDate(a.assignedAt) &&
          (a.unassignedAt === null ||
            p.data.workedOn <= istDate(a.unassignedAt))
      ) ??
      assignments[0]!;
    const check = checkHoursEntry({
      ...p.data,
      taskStatus: task.status,
      assignment,
      now: ctx.clock.now(),
      minutesLoggedThatDay: minutesLoggedOn(
        (await entriesFor(tx, uid)).map((r) => r.entry),
        p.data.workedOn
      ),
    });
    if (!check.ok) return { ok: false, error: check.problem } as const;
    const now = ctx.clock.now(),
      id = uuidv7(now);
    await tx.insert(volunteerHoursEntry).values({
      id,
      assignmentId: assignment.id,
      workedOn: p.data.workedOn,
      minutes: p.data.minutes,
      noteCiphertext: p.data.note?.trim()
        ? ctx.cipher.encrypt(WORK_PURPOSES.note, p.data.note.trim())
        : null,
      status: "submitted",
      createdAt: now,
    });
    await recordAudit(tx, ctx, {
      action: "volunteer.hours_logged",
      entity: { type: "volunteer_hours_entry", id },
      before: null,
      after: { taskId: task.id, status: "submitted" },
      actorRole: role,
    });
    return { ok: true, entryId: id } as const;
  });
}
export async function decideVolunteerHours(
  ctx: UseCaseContext,
  input: { entryId: string; reason?: string },
  decision: "approve" | "reject"
) {
  await authorize(ctx, "volunteer.work.manage");
  if (!idSchema.safeParse(input.entryId).success) throw forbidden();
  return ctx.db.transaction(async (tx) => {
    const [hint] = await tx
      .select({ uid: volunteerTaskAssignment.volunteerUserId })
      .from(volunteerHoursEntry)
      .innerJoin(
        volunteerTaskAssignment,
        eq(volunteerTaskAssignment.id, volunteerHoursEntry.assignmentId)
      )
      .where(eq(volunteerHoursEntry.id, input.entryId));
    if (!hint) throw forbidden();
    await lockVolunteer(tx, hint.uid);
    const { role } = await authorize(
      { ...ctx, db: tx },
      "volunteer.work.manage"
    );
    const [entry] = await tx
      .select()
      .from(volunteerHoursEntry)
      .where(eq(volunteerHoursEntry.id, input.entryId))
      .for("update");
    if (!entry) throw forbidden();
    const check = checkHoursDecision({
      status: entry.status,
      volunteerUserId: hint.uid,
      deciderUserId: actorId(ctx),
      decision:
        decision === "approve"
          ? { kind: decision }
          : { kind: decision, reason: input.reason ?? "" },
    });
    if (!check.ok) {
      if (check.problem === "own_hours") throw forbidden();
      return check.problem === "already_decided"
        ? transition
        : ({ ok: false, error: check.problem } as const);
    }
    const now = ctx.clock.now();
    await tx
      .update(volunteerHoursEntry)
      .set({
        status: check.to,
        decidedAt: now,
        decidedByUserId: actorId(ctx),
        rejectReasonCiphertext: check.reason
          ? ctx.cipher.encrypt(WORK_PURPOSES.reason, check.reason)
          : null,
      })
      .where(eq(volunteerHoursEntry.id, entry.id));
    if (check.to === "approved") {
      const subject = { kind: "user", userId: hint.uid } as const;
      await recordEngagement(tx, ctx, {
        type: "milestone",
        subject,
        kind: "volunteer",
        competitionId: null,
        occurredAt: now,
        sourceType: "volunteer_hours_entry",
        sourceId: entry.id,
      });
      await recordEngagement(tx, ctx, {
        type: "entry",
        subject,
        kind: "volunteer.hours_approved",
        occurredAt: now,
        sourceKey: hoursApprovedSourceKey(entry.id),
        refType: "volunteer_hours_entry",
        refId: entry.id,
      });
    }
    await emit(tx, ctx.clock, {
      type:
        check.to === "approved"
          ? "volunteer.hours_approved"
          : "volunteer.hours_rejected",
      aggregate: { type: "volunteer_hours_entry", id: entry.id },
      payload: { entryId: entry.id },
    });
    await recordAudit(tx, ctx, {
      action: `volunteer.hours_${check.to}`,
      entity: { type: "volunteer_hours_entry", id: entry.id },
      before: { status: "submitted" },
      after: { status: check.to },
      actorRole: role,
    });
    return { ok: true } as const;
  });
}
function hoursView(
  ctx: UseCaseContext,
  r: Awaited<ReturnType<typeof entriesFor>>[number]
) {
  return {
    id: r.entry.id,
    taskId: r.task.id,
    taskTitle: ctx.cipher.decrypt(WORK_PURPOSES.title, r.task.titleCiphertext),
    minutes: r.entry.minutes,
    workedOn: r.entry.workedOn,
    status: r.entry.status,
    decidedAt: r.entry.decidedAt,
    note: r.entry.noteCiphertext
      ? ctx.cipher.decrypt(WORK_PURPOSES.note, r.entry.noteCiphertext)
      : null,
    rejectReason: r.entry.rejectReasonCiphertext
      ? ctx.cipher.decrypt(WORK_PURPOSES.reason, r.entry.rejectReasonCiphertext)
      : null,
  };
}
async function recordFor(ctx: UseCaseContext, uid: string) {
  const assignments = await ctx.db
    .select({ task: volunteerTask, assignment: volunteerTaskAssignment })
    .from(volunteerTaskAssignment)
    .innerJoin(
      volunteerTask,
      eq(volunteerTask.id, volunteerTaskAssignment.taskId)
    )
    .where(eq(volunteerTaskAssignment.volunteerUserId, uid))
    .orderBy(desc(volunteerTaskAssignment.assignedAt));
  const latest = new Map<string, (typeof assignments)[number]>();
  for (const row of assignments) {
    const previous = latest.get(row.task.id);
    if (
      !previous ||
      (!row.assignment.unassignedAt && previous.assignment.unassignedAt)
    )
      latest.set(row.task.id, row);
  }
  const tasks = [...latest.values()].map((r) => ({
    ...taskView(ctx, r.task),
    assignedAt: r.assignment.assignedAt,
    unassignedAt: r.assignment.unassignedAt,
  }));
  const entries = await entriesFor(ctx.db, uid);
  return {
    tasks,
    entries: entries.map((r) => hoursView(ctx, r)),
    approvedMinutes: approvedMinutes(entries.map((r) => r.entry)),
  };
}
export async function getMyVolunteerRecord(ctx: UseCaseContext) {
  await authorize(ctx, "volunteer.work.own");
  return recordFor(ctx, actorId(ctx));
}
export async function getChildVolunteerRecord(
  ctx: UseCaseContext,
  { childId }: { childId: string }
) {
  const uid = actorId(ctx);
  if (
    !idSchema.safeParse(childId).success ||
    !(await isVerifiedGuardianOf(ctx.db, uid, childId))
  )
    throw forbidden();
  await authorize(ctx, "volunteer.child.view", { ownerId: uid });
  const [profile] = await ctx.db
    .select({ login: participantProfile.loginUserId })
    .from(participantProfile)
    .where(eq(participantProfile.id, childId));
  if (!profile?.login) return null;
  const [approved] = await ctx.db
    .select({ id: volunteerApplication.id })
    .from(volunteerApplication)
    .where(
      and(
        eq(volunteerApplication.applicantUserId, profile.login),
        eq(volunteerApplication.participantProfileId, childId),
        eq(volunteerApplication.status, "approved")
      )
    )
    .limit(1);
  return approved ? recordFor(ctx, profile.login) : null;
}
export async function listVolunteerHours(ctx: UseCaseContext) {
  await authorize(ctx, "volunteer.work.manage");
  const rows = await ctx.db
    .select({
      entry: volunteerHoursEntry,
      assignment: volunteerTaskAssignment,
      task: volunteerTask,
      name: user.name,
    })
    .from(volunteerHoursEntry)
    .innerJoin(
      volunteerTaskAssignment,
      eq(volunteerTaskAssignment.id, volunteerHoursEntry.assignmentId)
    )
    .innerJoin(
      volunteerTask,
      eq(volunteerTask.id, volunteerTaskAssignment.taskId)
    )
    .innerJoin(user, eq(user.id, volunteerTaskAssignment.volunteerUserId))
    .orderBy(desc(volunteerHoursEntry.createdAt));
  return rows.map((r) => ({ ...hoursView(ctx, r), volunteerName: r.name }));
}
