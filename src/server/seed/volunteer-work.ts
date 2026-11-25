// Synthetic preview fixtures only. Shared certificate numbering, render jobs
// and engagement writes are the real pipelines; no fabricated PDF bytes.
import { and, eq } from "drizzle-orm";
import {
  certificate,
  user,
  volunteerApplication,
  volunteerTask,
  volunteerTaskAssignment,
  volunteerHoursEntry,
} from "../db/schema";
import { insertCertificate } from "../modules/certificates/issue";
import { renderCertificate } from "../modules/certificates/render";
import { recordEngagement } from "../modules/community";
import {
  istDate,
  hoursApprovedSourceKey,
} from "../modules/volunteers/domain/hours";
import { WORK_PURPOSES } from "../modules/volunteers/work-fields";
import { gotenbergPdfRenderer } from "../ports/pdf-gotenberg";
import { seedFilesLocation } from "./files";
import { SEED_VOLUNTEERS } from "./volunteers";
import type { Seeder } from "./types";

const id = (n: number) =>
  `01938a00-0000-7000-8000-${String(124000 + n).padStart(12, "0")}`;
export const SEED_VOLUNTEER_TASKS = [
  {
    id: id(1),
    title: "Prepare animal welfare activity sheets",
    status: "draft",
  },
  { id: id(2), title: "Organise awareness materials", status: "open" },
  { id: id(3), title: "Create a reading list", status: "assigned" },
  {
    id: id(4),
    title: "Prepare volunteer welcome materials",
    status: "in_progress",
  },
  { id: id(5), title: "Help at the awareness stall", status: "done" },
  {
    id: id(6),
    title: "Archive duplicate activity materials",
    status: "cancelled",
  },
] as const;
const actor = { kind: "system", process: "seed" } as const;
export const seedVolunteerWork: Seeder = async (deps) => {
  const [volunteer] = await deps.db
    .select({ id: user.id, name: user.name })
    .from(user)
    .innerJoin(
      volunteerApplication,
      eq(volunteerApplication.applicantUserId, user.id)
    )
    .where(
      and(
        eq(volunteerApplication.id, SEED_VOLUNTEERS.approved.applicationId),
        eq(volunteerApplication.status, "approved"),
        eq(user.email, SEED_VOLUNTEERS.approved.email),
        eq(user.name, SEED_VOLUNTEERS.approved.name)
      )
    );
  const [manager] = await deps.db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.email, SEED_VOLUNTEERS.manager.email),
        eq(user.name, SEED_VOLUNTEERS.manager.name)
      )
    );
  if (!volunteer || !manager) return;
  const cert = await deps.db.transaction(async (tx) => {
    const now = deps.clock.now();
    let issued: typeof certificate.$inferSelect | undefined;
    for (const [index, task] of SEED_VOLUNTEER_TASKS.entries()) {
      const [created] = await tx
        .insert(volunteerTask)
        .values({
          id: task.id,
          titleCiphertext: deps.cipher.encrypt(WORK_PURPOSES.title, task.title),
          descriptionCiphertext: deps.cipher.encrypt(
            WORK_PURPOSES.description,
            "Support the community team's planned activity; coordinate materials with the manager."
          ),
          status: task.status,
          createdByUserId: manager.id,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (!created || index < 2) continue;
      await tx.insert(volunteerTaskAssignment).values({
        id: id(20 + index),
        taskId: task.id,
        volunteerUserId: volunteer.id,
        assignedByUserId: manager.id,
        assignedAt: now,
      });
      if (task.status === "done") {
        const rows = [
          { status: "approved", minutes: 145, n: 31 },
          { status: "submitted", minutes: 35, n: 32 },
          { status: "rejected", minutes: 15, n: 33 },
        ] as const;
        for (const r of rows)
          await tx.insert(volunteerHoursEntry).values({
            id: id(r.n),
            assignmentId: id(20 + index),
            workedOn: istDate(now),
            minutes: r.minutes,
            noteCiphertext: deps.cipher.encrypt(
              WORK_PURPOSES.note,
              "Set out and collected activity sheets."
            ),
            status: r.status,
            createdAt: now,
            decidedAt: r.status === "submitted" ? null : now,
            decidedByUserId: r.status === "submitted" ? null : manager.id,
            rejectReasonCiphertext:
              r.status === "rejected"
                ? deps.cipher.encrypt(
                    WORK_PURPOSES.reason,
                    "Duplicate time; please check your timesheet."
                  )
                : null,
          });
        await recordEngagement(
          tx,
          { clock: deps.clock, actor },
          {
            type: "milestone",
            subject: { kind: "user", userId: volunteer.id },
            kind: "volunteer",
            competitionId: null,
            occurredAt: now,
            sourceType: "volunteer_hours_entry",
            sourceId: id(31),
          }
        );
        await recordEngagement(
          tx,
          { clock: deps.clock, actor },
          {
            type: "entry",
            subject: { kind: "user", userId: volunteer.id },
            kind: "volunteer.hours_approved",
            occurredAt: now,
            sourceKey: hoursApprovedSourceKey(id(31)),
            refType: "volunteer_hours_entry",
            refId: id(31),
          }
        );
        issued = await insertCertificate(tx, deps.clock, {
          type: "volunteer_service",
          recipientUserId: volunteer.id,
          nameSnapshot: volunteer.name,
          approvedMinutesSnapshot: 145,
        });
      }
    }
    const [existing] = await tx
      .select()
      .from(certificate)
      .where(
        and(
          eq(certificate.recipientUserId, volunteer.id),
          eq(certificate.type, "volunteer_service"),
          eq(certificate.approvedMinutesSnapshot, 145)
        )
      );
    return issued ?? existing;
  });
  // Same explicit local rendering option as #100. Preview workers handle it otherwise.
  const baseUrl = process.env.GOTENBERG_URL;
  if (
    cert?.renderStatus === "pending" &&
    process.env.APP_ENV === "local" &&
    baseUrl &&
    deps.storage &&
    process.env.APP_URL
  )
    await renderCertificate(
      {
        ...deps,
        actor,
        auth: { baseUrl: process.env.APP_URL },
        files: seedFilesLocation(),
        storage: deps.storage,
        pdf: gotenbergPdfRenderer({ baseUrl }),
      },
      { certificateId: cert.id }
    );
};
