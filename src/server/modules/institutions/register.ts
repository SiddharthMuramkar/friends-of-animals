// Registering an institution (#73). A signed-in user, the institution's
// authorised person, sends its details; it starts pending verification and
// waits for FOA staff (./decide.ts). One open registration per person: a
// second waits until the first is rejected.

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { institution } from "../../db/schema";
import { signedInUser } from "../../identity/account";
import { uuidv7 } from "../../ids";
import { invalidInput, type InvalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import {
  registrationSchema,
  type RegisterInstitutionInput,
} from "./domain/registration";
import { sealPrincipalContact } from "./principal-contact";

export type RegisterInstitutionResult =
  | { ok: true; institutionId: string }
  | InvalidInput
  | { ok: false; error: "already_registered" };

export async function registerInstitution(
  ctx: UseCaseContext,
  input: RegisterInstitutionInput
): Promise<RegisterInstitutionResult> {
  const { role: actorRole } = await authorize(ctx, "institution.register");
  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { principalEmail, principalPhone, ...details } = parsed.data;
  const { userId } = signedInUser(ctx);
  const now = ctx.clock.now();
  const id = uuidv7(now);

  return ctx.db.transaction(async (tx) => {
    // The only unique rule a new row can break is one open registration
    // per person (institution_one_open_per_creator).
    const [inserted] = await tx
      .insert(institution)
      .values({
        id,
        ...details,
        ...sealPrincipalContact(ctx, { principalEmail, principalPhone }),
        status: "pending_verification",
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: institution.id });
    if (!inserted) return { ok: false, error: "already_registered" } as const;

    await recordAudit(tx, ctx, {
      action: "institution.registered",
      entity: { type: "institution", id },
      before: null,
      after: { status: "pending_verification" },
      actorRole,
    });
    return { ok: true, institutionId: id } as const;
  });
}
