// confirmRegistrations(tx, ctx, input) (#77): confirms registrations whose
// fee is paid, or whose competition is free, and gives each its
// registration number. Not a use case: the payments module calls it inside
// the transaction that records the capture (or finds the fee is zero), so
// the confirmations, their audit entries and their messages commit with it
// or not at all.
//
// Only a registration the machine lets the payment confirm is confirmed
// (enrolled, not withdrawn or already confirmed); the others come back as
// refused, unchanged. Each number is drawn in a savepoint, so a number
// that is already taken draws another without aborting the capture.
//
// Loads under plain Node (the seed script): relative imports only, no
// "server-only".

import { eq, inArray } from "drizzle-orm";

import type { Role } from "../../access/domain/roles";
import type { Actor } from "../../actor";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import { registration, REGISTRATION_NUMBER_UNIQUE } from "../../db/schema";
import { emit } from "../../outbox/emit";
import type { Clock } from "../../ports/clock";
import { withUniqueCode, type RandomBytes } from "../codes/codes";
import { registrationNumberFormat } from "./domain/registration-number";
import {
  canTransition,
  type RegistrationStatus,
} from "./domain/registration-status";

export type ConfirmRegistrationsInput = {
  registrationIds: readonly string[];
  /** The competition's code, which starts every number. */
  competitionCode: string;
  /** The batch whose capture confirms them; null for a free competition. */
  batchId: string | null;
  /** The role that allowed the action, for the audit log. */
  actorRole: Role | null;
  random?: RandomBytes;
};

export type ConfirmRegistrationsResult = {
  confirmed: { registrationId: string; registrationNumber: string }[];
  refused: { registrationId: string; status: RegistrationStatus }[];
};

export async function confirmRegistrations(
  tx: AppDb,
  ctx: { clock: Clock; actor: Actor },
  input: ConfirmRegistrationsInput
): Promise<ConfirmRegistrationsResult> {
  const result: ConfirmRegistrationsResult = { confirmed: [], refused: [] };
  if (input.registrationIds.length === 0) return result;
  const now = ctx.clock.now();
  // In id order, so two transactions lock them in the same order.
  const rows = await tx
    .select({ id: registration.id, status: registration.status })
    .from(registration)
    .where(inArray(registration.id, [...input.registrationIds]))
    .orderBy(registration.id)
    .for("update");

  for (const row of rows) {
    if (!canTransition(row.status, "confirmed", "payment")) {
      result.refused.push({ registrationId: row.id, status: row.status });
      continue;
    }
    const registrationNumber = await withUniqueCode(
      {
        format: registrationNumberFormat(input.competitionCode),
        constraint: REGISTRATION_NUMBER_UNIQUE,
        ...(input.random ? { random: input.random } : {}),
      },
      (code) =>
        tx.transaction(async (savepoint) => {
          await savepoint
            .update(registration)
            .set({
              status: "confirmed",
              registrationNumber: code,
              updatedAt: now,
            })
            .where(eq(registration.id, row.id));
          return code;
        })
    );
    await recordAudit(tx, ctx, {
      action: "registration.confirmed",
      entity: { type: "registration", id: row.id },
      before: { status: row.status },
      after: {
        status: "confirmed",
        registrationNumber,
        batchId: input.batchId,
      },
      actorRole: input.actorRole,
    });
    await emit(tx, ctx.clock, {
      type: "registration.confirmed",
      aggregate: { type: "registration", id: row.id },
      payload: { registrationId: row.id },
    });
    result.confirmed.push({ registrationId: row.id, registrationNumber });
  }
  return result;
}
