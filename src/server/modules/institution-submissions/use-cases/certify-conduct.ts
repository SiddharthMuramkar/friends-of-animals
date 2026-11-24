// certifyConduct({ institutionId, reference }) (#87): one of the
// institution's coordinators, or its authorised person, certifies that the
// competition was run in the school according to FOA's guidelines (the
// statement in ../domain/conduct-statement.ts). Once per institution
// registration, recorded with who and when, and audit-logged
// (`conduct.certified`, with the request's IP and user agent). A second
// certification, even at the same moment, answers already_certified and
// records nothing. It needs at least one confirmed student, and a
// competition that wasn't cancelled.
//
// Loads under plain Node: relative imports only, no "server-only".

import { z } from "zod";

import { authorize } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import { conductCertification } from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { invalidInput, type InvalidInput } from "../../../input";
import type { UseCaseContext } from "../../../use-cases";
import { institutionResource } from "../../institutions/coordinators/policy";
import { CONDUCT_STATEMENT_VERSION } from "../domain/conduct-statement";
import { loadRegistrationScope } from "../registration-scope";

export type CertifyConductResult =
  | { ok: true; certifiedAt: Date }
  | InvalidInput
  | {
      ok: false;
      error:
        | "not_found"
        | "already_certified"
        | "no_confirmed_students"
        | "competition_cancelled";
    };

export const registrationInput = z.object({
  institutionId: z.uuid(),
  reference: z.string().max(40),
});

export async function certifyConduct(
  ctx: UseCaseContext,
  input: { institutionId: string; reference: string }
): Promise<CertifyConductResult> {
  const parsed = registrationInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { role } = await authorize(
    ctx,
    "conduct.certify",
    institutionResource(parsed.data.institutionId)
  );
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const userId = ctx.actor.userId;

  return ctx.db.transaction(async (tx): Promise<CertifyConductResult> => {
    const scope = await loadRegistrationScope(tx, parsed.data, { lock: true });
    if (!scope) return { ok: false, error: "not_found" };
    if (scope.competition.status === "cancelled") {
      return { ok: false, error: "competition_cancelled" };
    }
    if (scope.confirmedStudents === 0) {
      return { ok: false, error: "no_confirmed_students" };
    }
    const now = ctx.clock.now();
    const [inserted] = await tx
      .insert(conductCertification)
      .values({
        id: uuidv7(now),
        institutionRegistrationId: scope.id,
        certifiedByUserId: userId,
        certifiedAt: now,
        statementVersion: CONDUCT_STATEMENT_VERSION,
      })
      .onConflictDoNothing({
        target: conductCertification.institutionRegistrationId,
      })
      .returning({ id: conductCertification.id });
    if (!inserted) return { ok: false, error: "already_certified" };
    await recordAudit(tx, ctx, {
      action: "conduct.certified",
      entity: { type: "institution_registration", id: scope.id },
      before: null,
      after: { statementVersion: CONDUCT_STATEMENT_VERSION },
      actorRole: role,
    });
    return { ok: true, certifiedAt: now };
  });
}
