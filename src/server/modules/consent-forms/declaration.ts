import { and, eq } from "drizzle-orm";
import type { z } from "zod";

import { recordAudit } from "../../audit/record";
import { institutionRegistration } from "../../db/schema";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import {
  authorizeSchool,
  canCollectSchoolConsent,
  consentFormsAvailable,
  schoolScopeInput,
} from "./scope";

export async function declareParticipation(
  ctx: UseCaseContext,
  input: z.input<typeof schoolScopeInput>
) {
  const parsed = schoolScopeInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { registrationId } = parsed.data;
  return ctx.db.transaction(async (tx) => {
    const { userId, role, school } = await authorizeSchool(
      ctx,
      tx,
      "consent_form.declare",
      parsed.data,
      { lock: true }
    );
    if (!consentFormsAvailable(ctx))
      return { ok: false, error: "unavailable" } as const;
    if (school.participationDeclaredAt)
      return { ok: true, declaredAt: school.participationDeclaredAt } as const;
    if (!canCollectSchoolConsent(school))
      return { ok: false, error: "not_found" } as const;
    const now = ctx.clock.now();
    await tx
      .update(institutionRegistration)
      .set({
        participationDeclaredAt: now,
        participationDeclaredByUserId: userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(institutionRegistration.id, registrationId),
          eq(institutionRegistration.institutionId, school.institutionId)
        )
      );
    await recordAudit(tx, ctx, {
      action: "consent_form.participation_declared",
      entity: { type: "institution_registration", id: registrationId },
      actorRole: role,
      before: null,
      after: { declaredAt: now },
    });
    return { ok: true, declaredAt: now } as const;
  });
}
