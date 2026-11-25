import { and, eq, asc, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import type { AppDb } from "../../db/app-db";
import {
  auctionLot,
  physicalArtwork,
  consentEvent,
  outbox,
  type AuctionLotRow,
} from "../../db/schema";
import type { UseCaseContext } from "../../use-cases";
import type { EventOf } from "../../outbox/events";
import { emit, type OutboxDeps } from "../../outbox";
import { invalidInput } from "../../input";
import { auctionConsentCredit } from "../consent/auction-credit";
import { releaseFromAuction } from "../physical-artwork/auction-hold";
import {
  decideLotTransition,
  ACTIVE_LOT_STATUSES,
  type LotCommand,
} from "./domain/lot-status";
import { readSetting } from "../settings/read";
import { closedWinningBid } from "./bid-history";
import { validateLotTerms } from "./domain/lot-terms";
import type { Role } from "../../access/domain/roles";

export type LotContext = Pick<
  UseCaseContext,
  "db" | "clock" | "actor" | "settings" | "cipher" | "appEnv"
>;
const lotInput = z.object({ lotId: z.uuid() });
const cancelInput = lotInput.extend({
  reason: z.string().trim().min(1).max(500),
});
export type LotInput = z.input<typeof lotInput>;
export type CancelLotInput = z.input<typeof cancelInput>;

export async function currentLotConsent(
  ctx: Pick<UseCaseContext, "db" | "cipher" | "clock">,
  lot: AuctionLotRow,
  lock = false
) {
  const [artwork] = await ctx.db
    .select({
      registrationId: physicalArtwork.registrationId,
      status: physicalArtwork.status,
    })
    .from(physicalArtwork)
    .where(eq(physicalArtwork.id, lot.artworkId));
  if (!artwork || artwork.status !== lot.artworkStatusBeforeListing)
    return null;
  const consent = await auctionConsentCredit(ctx, artwork.registrationId, lock);
  return consent?.consentEventId === lot.consentEventId ? consent : null;
}

export async function auctionsEnabled(ctx: Pick<UseCaseContext, "settings">) {
  return ctx.settings.get("auctions.enabled");
}

/** Locks and moves a lot atomically with its custody release, outbox and audit.
 * Workers must re-read dates and consent: delayed or duplicated jobs are safe. */
async function move(
  ctx: LotContext,
  input: LotInput,
  command: LotCommand,
  reason?: string
) {
  const staff = command === "schedule" || command === "cancel";
  const { role } = await authorize(
    ctx,
    staff ? "auction.lot.manage" : "auction.lot.run"
  );
  const parsed = lotInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return ctx.db.transaction(async (tx) => {
    const [lot] = await tx
      .select()
      .from(auctionLot)
      .where(eq(auctionLot.id, parsed.data.lotId))
      .for("update");
    if (!lot) return { ok: false, error: "not_found" } as const;
    const decision = decideLotTransition({ from: lot.status, command });
    if (!decision.ok) return decision;
    const time = ctx.clock.now();
    if (command === "schedule") {
      if (!(await readSetting(tx, "auctions.enabled", { lock: "share" })))
        return { ok: false, error: "auctions_disabled" } as const;
      const valid = validateLotTerms(lot, time);
      if (!valid.ok)
        return {
          ok: false,
          error: "invalid_terms",
          errors: valid.errors,
        } as const;
    }
    if (command === "open" && (time < lot.opensAt || time >= lot.closesAt))
      return { ok: false, error: "not_due" } as const;
    if (command === "close" && time < lot.closesAt) {
      // A stale close delivery cannot prematurely close an extended lot.
      // A replay must not queue another job for the same current deadline.
      const [replacement] = await tx
        .select({ id: outbox.id })
        .from(outbox)
        .where(
          and(
            eq(outbox.eventType, "auction.lot.close"),
            eq(outbox.aggregateId, lot.id),
            eq(outbox.status, "pending"),
            eq(outbox.availableAt, lot.closesAt)
          )
        )
        .limit(1);
      if (!replacement)
        await emit(
          tx,
          ctx.clock,
          {
            type: "auction.lot.close",
            aggregate: { type: "auction_lot", id: lot.id },
            payload: { lotId: lot.id },
          },
          { availableAt: lot.closesAt }
        );
      return { ok: false, error: "not_due" } as const;
    }
    if (
      command === "schedule" ||
      command === "open" ||
      command === "close" ||
      command === "settle_unsold"
    ) {
      if (!(await currentLotConsent({ ...ctx, db: tx }, lot, true))) {
        await applyMove(
          tx,
          ctx,
          lot,
          "withdraw_consent",
          role,
          "consent_withdrawn"
        );
        return { ok: false, error: "auction_consent_missing" } as const;
      }
    }
    if (
      command === "open" &&
      !(await readSetting(tx, "auctions.enabled", { lock: "share" }))
    ) {
      await applyMove(tx, ctx, lot, "cancel", role, "auctions_disabled");
      return { ok: false, error: "auctions_disabled" } as const;
    }
    if (command === "settle_unsold" && (await closedWinningBid(tx, lot))) {
      // Leave a reserve-met winner and its original reserved in `closed`.
      // #133 will atomically take this handoff to awaiting_payment.
      return { ok: true, status: "closed" } as const;
    }
    return applyMove(tx, ctx, lot, command, role, reason);
  });
}

async function applyMove(
  tx: AppDb,
  ctx: LotContext,
  lot: AuctionLotRow,
  command: LotCommand,
  role: Role | null,
  reason?: string
) {
  const decision = decideLotTransition({ from: lot.status, command });
  if (!decision.ok) return decision;
  // Lock original before changing lot status, so work released by this
  // commit cannot race a new lot or physical move.
  await tx
    .select({ id: physicalArtwork.id })
    .from(physicalArtwork)
    .where(eq(physicalArtwork.id, lot.artworkId))
    .for("update");
  const now = ctx.clock.now();
  await tx
    .update(auctionLot)
    .set({
      status: decision.to,
      updatedAt: now,
      ...(decision.to === "cancelled"
        ? { cancellationReason: reason ?? "consent_withdrawn" }
        : {}),
    })
    .where(eq(auctionLot.id, lot.id));
  if (decision.restoresArtwork)
    await releaseFromAuction(tx, ctx, {
      artworkId: lot.artworkId,
      lotId: lot.id,
      restoreTo: lot.artworkStatusBeforeListing,
    });
  await recordAudit(tx, ctx, {
    action: "auction_lot." + decision.to,
    entity: { type: "auction_lot", id: lot.id },
    before: { status: lot.status },
    after: { status: decision.to },
    actorRole: role,
  });
  if (decision.event) {
    const aggregate = { type: "auction_lot" as const, id: lot.id },
      payload = { lotId: lot.id };
    await emit(tx, ctx.clock, { type: decision.event, aggregate, payload });
  }
  if (command === "schedule") {
    const aggregate = { type: "auction_lot" as const, id: lot.id },
      payload = { lotId: lot.id };
    await emit(
      tx,
      ctx.clock,
      { type: "auction.lot.open", aggregate, payload },
      { availableAt: lot.opensAt }
    );
    await emit(
      tx,
      ctx.clock,
      { type: "auction.lot.close", aggregate, payload },
      { availableAt: lot.closesAt }
    );
  }
  return { ok: true, status: decision.to } as const;
}

export const scheduleLot = (ctx: LotContext, input: LotInput) =>
  move(ctx, input, "schedule");
export async function cancelLot(ctx: LotContext, input: CancelLotInput) {
  await authorize(ctx, "auction.lot.manage");
  const parsed = cancelInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return move(ctx, parsed.data, "cancel", parsed.data.reason);
}
export async function openLot(ctx: LotContext, input: LotInput) {
  await authorize(ctx, "auction.lot.run");
  // An open job delivered after both instants cannot leave a scheduled
  // lot hanging. Cancel without accepting a bid.
  const parsed = lotInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const result = await move(ctx, input, "open");
  if (!result.ok && result.error === "not_due") {
    await ctx.db.transaction(async (tx) => {
      const [lot] = await tx
        .select()
        .from(auctionLot)
        .where(eq(auctionLot.id, input.lotId))
        .for("update");
      if (lot?.status === "scheduled" && ctx.clock.now() >= lot.closesAt)
        await applyMove(tx, ctx, lot, "cancel", null, "missed_opening");
    });
  }
  return result;
}
export async function closeLot(ctx: LotContext, input: LotInput) {
  await authorize(ctx, "auction.lot.run");
  const parsed = lotInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return move(ctx, input, "close");
}
export const settleClosedLot = (ctx: LotContext, input: LotInput) =>
  move(ctx, input, "settle_unsold");

const worker = (deps: OutboxDeps): LotContext => ({
  ...deps,
  actor: { kind: "system", process: "worker" },
});
export const runOpenLot = (deps: OutboxDeps, input: LotInput) =>
  openLot(worker(deps), input);
export const runCloseLot = (deps: OutboxDeps, input: LotInput) =>
  closeLot(worker(deps), input);
export const runSettleClosedLot = (deps: OutboxDeps, input: LotInput) =>
  settleClosedLot(worker(deps), input);

/** The withdrawal must cancel lots that relied on the withdrawn evidence,
 * even if a new grant arrives before this event drains. Never cancel a
 * newer lot created on evidence issued after the withdrawal. */
export async function withdrawAuctionConsent(
  deps: OutboxDeps,
  payload: EventOf<"consent.withdrawn">["payload"]
) {
  if (payload.purpose !== "auction" || payload.competitionId === null) return;
  const ctx = worker(deps);
  const rows = await deps.db
    .select({ id: auctionLot.id })
    .from(auctionLot)
    .innerJoin(consentEvent, eq(consentEvent.id, auctionLot.consentEventId))
    .where(
      and(
        inArray(auctionLot.status, ACTIVE_LOT_STATUSES),
        eq(consentEvent.subjectType, payload.subjectType),
        eq(consentEvent.subjectId, payload.subjectId),
        eq(consentEvent.competitionId, payload.competitionId),
        lt(consentEvent.id, payload.consentEventId)
      )
    )
    .orderBy(asc(auctionLot.id));
  for (const row of rows)
    await move(ctx, { lotId: row.id }, "withdraw_consent", "consent_withdrawn");
}
