// verifyEntry({ entryId }) and sendBackEntry({ entryId, reason }) (#92):
// an FOA verifier's decision on an entry waiting for verification. In one
// transaction:
//
// 1. on the school route, lock the entry's school round first (F15: a
//    reopening of the round, #90, waits for the decision, and refuses once
//    an entry is verified); then lock the entry;
// 2. ask the pure rules (../domain/decide.ts) with the entry's status and
//    its latest record; a send-back needs a preset reason, "other" a note
//    of up to 500 characters, and gets a deadline of now plus the
//    `entries.resubmissionDays` setting;
// 3. keep the decision as a new entry_verification row (the history keeps
//    every one), move the entry through the entries module (one
//    entry_transition row and one audit row, with the reason), and emit
//    entry.foa_verified or entry.sent_back, which tells the participant or
//    their guardian, or the school's coordinators.
//
// Loads under plain Node: relative imports only, no "server-only".

import { z } from "zod";

import { authorize } from "../../../access/can";
import { entryVerification } from "../../../db/schema";
import { invalidInput, type InvalidInput } from "../../../input";
import { emit } from "../../../outbox/emit";
import type { UseCaseContext } from "../../../use-cases";
import { lockEntry } from "../../entries/store";
import { applyVerificationMove } from "../../entries/verification-move";
import {
  decide,
  type VerificationCommand,
  type VerificationRefusal,
} from "../domain/decide";
import {
  latestVerification,
  lockRoundOf,
  nextVerificationId,
  routeOfEntry,
  verificationStateOf,
} from "../store";

const entryInput = z.object({ entryId: z.uuid() });

const sendBackInput = entryInput.extend({
  reason: z.object({
    code: z.string().max(40).optional(),
    text: z.string().max(5000).optional(),
  }),
});

export type VerifyEntryInput = z.input<typeof entryInput>;
export type SendBackEntryInput = z.input<typeof sendBackInput>;

export type DecideEntryResult =
  | { ok: true; status: "foa_verified" }
  | { ok: true; status: "sent_back"; resubmissionDueAt: Date }
  | InvalidInput
  | { ok: false; error: "not_found" | VerificationRefusal };

export async function verifyEntry(
  ctx: UseCaseContext,
  input: VerifyEntryInput
): Promise<DecideEntryResult> {
  const { role } = await authorize(ctx, "verification.decide");
  const parsed = entryInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return decideOn(ctx, parsed.data.entryId, role, { kind: "verify" });
}

export async function sendBackEntry(
  ctx: UseCaseContext,
  input: SendBackEntryInput
): Promise<DecideEntryResult> {
  const { role } = await authorize(ctx, "verification.decide");
  const parsed = sendBackInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  // Settings are read on their own connection, before the transaction.
  const resubmissionDays = await ctx.settings.get("entries.resubmissionDays");
  return decideOn(ctx, parsed.data.entryId, role, {
    kind: "send_back",
    reason: parsed.data.reason,
    resubmissionDays,
  });
}

async function decideOn(
  ctx: UseCaseContext,
  entryId: string,
  role: Awaited<ReturnType<typeof authorize>>["role"],
  command: Extract<VerificationCommand, { kind: "verify" | "send_back" }>
): Promise<DecideEntryResult> {
  if (ctx.actor.kind !== "user") throw new Error("unreachable");
  const userId = ctx.actor.userId;
  return ctx.db.transaction(async (tx): Promise<DecideEntryResult> => {
    const route = await routeOfEntry(tx, { entryId });
    if (!route) return { ok: false, error: "not_found" };
    await lockRoundOf(tx, route);
    const locked = await lockEntry(tx, entryId);
    if (!locked) return { ok: false, error: "not_found" };
    const from = locked.row.status;
    const now = ctx.clock.now();
    const decision = decide(
      verificationStateOf(from, await latestVerification(tx, entryId)),
      command,
      now
    );
    if (!decision.ok) return { ok: false, error: decision.code };

    const verificationId = nextVerificationId(now);
    if (decision.to === "sent_back") {
      await tx.insert(entryVerification).values({
        id: verificationId,
        entryId,
        decision: "sent_back",
        reasonCode: decision.reason.code,
        reasonText: decision.reason.text,
        decidedByUserId: userId,
        decidedAt: now,
        resubmissionDueAt: decision.resubmissionDueAt,
      });
    } else if (decision.to === "foa_verified") {
      await tx.insert(entryVerification).values({
        id: verificationId,
        entryId,
        decision: "verified",
        decidedByUserId: userId,
        decidedAt: now,
      });
    } else {
      throw new Error(`A verifier's decision can't move an entry to ${decision.to}`);
    }
    await applyVerificationMove(tx, ctx, {
      entryId,
      from,
      to: decision.to,
      actorRole: role,
      details:
        decision.to === "sent_back"
          ? {
              verificationId,
              reasonCode: decision.reason.code,
              resubmissionDueAt: decision.resubmissionDueAt.toISOString(),
            }
          : { verificationId },
    });
    await emit(tx, ctx.clock, {
      type: decision.event,
      aggregate: { type: "entry", id: entryId },
      payload: {
        entryId,
        registrationId: route.registrationId,
        institutionRegistrationId: route.institutionRegistrationId,
        verificationId,
      },
    });
    return decision.to === "sent_back"
      ? {
          ok: true,
          status: "sent_back",
          resubmissionDueAt: decision.resubmissionDueAt,
        }
      : { ok: true, status: "foa_verified" };
  });
}
