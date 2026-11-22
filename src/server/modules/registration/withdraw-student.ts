// withdrawStudent({ institutionId, reference, registrationId }) (#75): a
// coordinator, or the authorised person, withdraws a student enrolled
// under the institution's registration while registration is open. The
// registration stays, withdrawn, as history; enrolling the child again
// makes a new one. That is also how a mistake in a student's details is
// put right while registration is open.

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { registration } from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { institutionResource } from "../institutions/coordinators/policy";
import type { EnrolmentState } from "./domain/enrolment-state";
import { canTransition } from "./domain/registration-status";
import { loadEnrolmentFacts } from "./enrolment-facts";

export type WithdrawStudentInput = {
  institutionId: string;
  reference: string;
  registrationId: string;
};

export type WithdrawStudentResult =
  | { ok: true }
  | InvalidInput
  | {
      ok: false;
      error: "not_found" | Exclude<EnrolmentState, "open"> | "not_enrolled";
    };

const withdrawInput = z.object({
  institutionId: z.uuid(),
  reference: z.string().max(40),
  registrationId: z.uuid(),
});

export async function withdrawStudent(
  ctx: UseCaseContext,
  input: WithdrawStudentInput
): Promise<WithdrawStudentResult> {
  const parsed = withdrawInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { institutionId, reference, registrationId } = parsed.data;
  const resource = institutionResource(institutionId);
  await authorize(ctx, "institution.coordinate", resource);
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const facts = await loadEnrolmentFacts(
      tx,
      { institutionId, reference },
      now,
      { lock: true }
    );
    const { role: actorRole } = await authorize(
      { db: tx, clock: ctx.clock, actor: ctx.actor },
      "institution.coordinate",
      resource
    );
    if (!facts) return { ok: false, error: "not_found" } as const;
    const [row] = await tx
      .select({ status: registration.status })
      .from(registration)
      .where(
        and(
          eq(registration.id, registrationId),
          eq(
            registration.institutionRegistrationId,
            facts.institutionRegistration.id
          )
        )
      )
      .for("update");
    if (!row) return { ok: false, error: "not_found" } as const;
    if (facts.enrolment !== "open") {
      return { ok: false, error: facts.enrolment } as const;
    }
    if (!canTransition(row.status, "withdrawn", "coordinator")) {
      return { ok: false, error: "not_enrolled" } as const;
    }

    await tx
      .update(registration)
      .set({ status: "withdrawn", updatedAt: now })
      .where(eq(registration.id, registrationId));
    await recordAudit(tx, ctx, {
      action: "registration.student_withdrawn",
      entity: { type: "registration", id: registrationId },
      before: { status: row.status },
      after: { status: "withdrawn" },
      actorRole,
    });
    return { ok: true } as const;
  });
}
