// Forwarding individual entries to FOA (#92). The individual route skips
// the school round: once a competition's submissions close, each of its
// individual entries that is submitted goes on to FOA (submitted →
// submitted_to_foa) to wait for a verifier.
//
//   forwardIndividualEntries({ competitionId, entryId? })  → the platform only
//
// Two outbox handlers call it as the worker:
// - verification.forward_individual_entries, after
//   competition.submissions_closed (the submissions_close status job);
// - verification.forward_late_entry, after entry.submitted: an entry whose
//   file was still being checked at the deadline goes as soon as it is
//   submitted.
//
// School-route entries, entries never submitted (rejected, failed) and a
// cancelled competition's entries are never forwarded. Safe to repeat: an
// entry already forwarded is no longer `submitted`.
//
// Loads under plain Node (the worker): relative imports only.

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import type { Actor } from "../../actor";
import type { AppDb } from "../../db/app-db";
import { competition, entry, registration } from "../../db/schema";
import { invalidInput, type InvalidInput } from "../../input";
import type { Clock } from "../../ports/clock";
import { submissionWindows } from "../entries/registration-facts";
import { applyVerificationMove } from "../entries/verification-move";
import { decide } from "./domain/decide";
import { WORKER } from "./store";

const forwardInput = z.object({
  competitionId: z.uuid(),
  entryId: z.uuid().optional(),
});

export type ForwardIndividualEntriesInput = z.input<typeof forwardInput>;

export type ForwardIndividualEntriesResult =
  | { ok: true; forwarded: number }
  | InvalidInput;

export async function forwardIndividualEntries(
  ctx: { db: AppDb; clock: Clock; actor: Actor },
  input: ForwardIndividualEntriesInput
): Promise<ForwardIndividualEntriesResult> {
  await authorize(ctx, "verification.forward");
  const parsed = forwardInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { competitionId, entryId } = parsed.data;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const [held] = await tx
      .select({ status: competition.status })
      .from(competition)
      .where(eq(competition.id, competitionId))
      .for("share");
    const window = (await submissionWindows(tx, [competitionId])).get(
      competitionId
    );
    if (!held || held.status === "cancelled" || !window) {
      return { ok: true, forwarded: 0 } as const;
    }
    const candidates = await tx
      .select({ id: entry.id, status: entry.status })
      .from(entry)
      .innerJoin(registration, eq(registration.id, entry.registrationId))
      .where(
        and(
          eq(entry.competitionId, competitionId),
          eq(registration.route, "individual"),
          eq(entry.status, "submitted"),
          ...(entryId ? [eq(entry.id, entryId)] : [])
        )
      )
      .orderBy(asc(entry.id))
      .for("update", { of: entry });
    let forwarded = 0;
    for (const candidate of candidates) {
      const decision = decide(
        {
          status: candidate.status,
          resubmissionDueAt: null,
          resubmissionPending: false,
        },
        {
          kind: "forward",
          route: "individual",
          submissionClosesAt: window.closesAt,
        },
        now
      );
      if (!decision.ok || decision.to !== "submitted_to_foa") continue;
      await applyVerificationMove(tx, ctx, {
        entryId: candidate.id,
        from: candidate.status,
        to: "submitted_to_foa",
        actorRole: null,
      });
      forwarded += 1;
    }
    return { ok: true, forwarded } as const;
  });
}

/** verification.forward_individual_entries: a competition's submissions closed. */
export async function forwardOnSubmissionsClosed(
  deps: { db: AppDb; clock: Clock },
  payload: { competitionId: string }
): Promise<void> {
  await forwardIndividualEntries(
    { db: deps.db, clock: deps.clock, actor: WORKER },
    payload
  );
}

/** verification.forward_late_entry: an entry was submitted, perhaps after the deadline. */
export async function forwardLateEntry(
  deps: { db: AppDb; clock: Clock },
  payload: { entryId: string }
): Promise<void> {
  const [row] = await deps.db
    .select({ competitionId: entry.competitionId })
    .from(entry)
    .where(eq(entry.id, payload.entryId));
  if (!row) return;
  await forwardIndividualEntries(
    { db: deps.db, clock: deps.clock, actor: WORKER },
    { competitionId: row.competitionId, entryId: payload.entryId }
  );
}
