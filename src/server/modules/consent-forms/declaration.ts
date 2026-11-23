import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { recordAudit } from "../../audit/record";
import { institutionRegistration } from "../../db/schema";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { authorizeSchool, consentFormsAvailable } from "./scope";

const declarationInput = z.object({ registrationId: z.uuid() });

export async function declareParticipation(
  ctx: UseCaseContext,
  input: z.input<typeof declarationInput>
) {
  const parsed = declarationInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { registrationId } = parsed.data;
  return ctx.db.transaction(async (tx) => {
    const { userId, role } = await authorizeSchool(
      ctx,
      tx,
      "consent_form.declare",
      registrationId
    );
    if (!consentFormsAvailable(ctx))
      return { ok: false, error: "unavailable" } as const;
    const now = ctx.clock.now();
    const [declared] = await tx
      .update(institutionRegistration)
      .set({
        participationDeclaredAt: now,
        participationDeclaredByUserId: userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(institutionRegistration.id, registrationId),
          eq(institutionRegistration.status, "active"),
          isNull(institutionRegistration.participationDeclaredAt)
        )
      )
      .returning({ id: institutionRegistration.id });
    if (!declared) {
      const [current] = await tx
        .select({ at: institutionRegistration.participationDeclaredAt })
        .from(institutionRegistration)
        .where(eq(institutionRegistration.id, registrationId));
      return current?.at
        ? ({ ok: true, declaredAt: current.at } as const)
        : ({ ok: false, error: "not_found" } as const);
    }
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
