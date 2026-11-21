// requestPhysicalArtwork (#93): a competition manager asks FOA-verified
// entries to courier in their original work. Each gets an Artwork ID, a
// dispatch deadline and a snapshot of what its sender is told (packaging
// instructions, who pays shipping, FOA's address). All or nothing: one
// entry refused refuses the request, and nothing is written.
//
// Loads under plain Node: relative imports only, no "server-only".

import { inArray } from "drizzle-orm";
import { z } from "zod";

import { physicalArtwork } from "../../../db/schema";
import { uuidv7 } from "../../../ids";
import { emit } from "../../../outbox";
import type { UseCaseContext } from "../../../use-cases";
import { artworkCodeFormat } from "../domain/code";
import {
  decideArtworkRequest,
  type ArtworkRequestRefusal,
} from "../domain/decide";
import type { ArtworkEntry, ArtworkPlatform } from "../platform";
import { actingUserId } from "./actor";
import { idList, invalidInput, type InvalidInput } from "./input";

/** The most entries one request may name. */
export const REQUEST_ENTRIES_MAX = 200;

/** The longest packaging instructions, in characters. */
export const PACKAGING_INSTRUCTIONS_MAX = 2000;

/** The unique constraint that keeps Artwork IDs apart. */
const ARTWORK_CODE_CONSTRAINT = "physical_artwork_artwork_code_key";

const requestInput = z.object({
  competitionId: z.uuid(),
  entryIds: idList(REQUEST_ENTRIES_MAX),
  /** The form starts from the setting; the manager may edit it. */
  packagingInstructions: z
    .string()
    .trim()
    .min(1)
    .max(PACKAGING_INSTRUCTIONS_MAX)
    .optional(),
  shippingPayer: z.enum(["foa", "sender"]).optional(),
});

export type RequestPhysicalArtworkInput = z.input<typeof requestInput>;

export type RequestedArtwork = {
  artworkId: string;
  artworkCode: string;
  entryId: string;
  dispatchDeadline: Date;
};

export type RequestPhysicalArtworkResult =
  | { ok: true; artworks: RequestedArtwork[] }
  | InvalidInput
  /** The competition, or an entry in it, doesn't exist. */
  | { ok: false; error: "not_found" }
  /** FOA's address is still the placeholder, in production. */
  | { ok: false; error: "facility_address_not_configured" }
  /** The first entry refused, in the order given. */
  | { ok: false; error: ArtworkRequestRefusal; entryId: string };

export async function requestPhysicalArtwork(
  ctx: UseCaseContext,
  platform: ArtworkPlatform,
  input: RequestPhysicalArtworkInput
): Promise<RequestPhysicalArtworkResult> {
  const { role } = await platform.authorizeStaff(
    ctx,
    "artwork.request",
    typeof input.competitionId === "string" ? input.competitionId : null
  );
  const parsed = requestInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { competitionId, entryIds } = parsed.data;
  const requestedBy = actingUserId(ctx);

  return ctx.db.transaction(
    async (tx): Promise<RequestPhysicalArtworkResult> => {
      const competition = await platform.competition(tx, competitionId);
      if (!competition) return { ok: false, error: "not_found" };
      const found = new Map(
        (await platform.entries(tx, entryIds)).map((entry) => [
          entry.id,
          entry,
        ])
      );
      const entries: ArtworkEntry[] = [];
      for (const id of entryIds) {
        const entry = found.get(id);
        if (!entry || entry.competitionId !== competition.id) {
          return { ok: false, error: "not_found" };
        }
        entries.push(entry);
      }

      const settings = await platform.settings(tx);
      const alreadyRequested = new Set(
        (
          await tx
            .select({ entryId: physicalArtwork.entryId })
            .from(physicalArtwork)
            .where(inArray(physicalArtwork.entryId, entryIds))
        ).map((row) => row.entryId)
      );
      const now = ctx.clock.now();
      const planned = [];
      for (const entry of entries) {
        const decision = decideArtworkRequest(
          {
            entryStatus: entry.status,
            physicalArtworkRequired: competition.physicalArtworkRequired,
            alreadyRequested: alreadyRequested.has(entry.id),
          },
          {
            dispatchDays: settings.dispatchDays,
            reminderLeadHours: settings.reminderLeadHours,
          },
          now
        );
        if (!decision.ok) {
          return { ok: false, error: decision.code, entryId: entry.id };
        }
        planned.push({ entry, decision });
      }
      if (settings.facilityAddress === null) {
        return { ok: false, error: "facility_address_not_configured" };
      }

      const told = {
        packagingInstructions:
          parsed.data.packagingInstructions ?? settings.packagingInstructions,
        shippingPayer: parsed.data.shippingPayer ?? settings.shippingPayer,
        facilityAddress: settings.facilityAddress,
      };
      const artworks: RequestedArtwork[] = [];
      for (const { entry, decision } of planned) {
        const id = uuidv7(now);
        // Each attempt in a savepoint, so a taken code rolls back only that
        // insert and the codes module can draw another.
        const artworkCode = await platform.withUniqueCode(
          {
            format: artworkCodeFormat(competition.code),
            constraint: ARTWORK_CODE_CONSTRAINT,
          },
          (code) =>
            tx.transaction(async (savepoint) => {
              await savepoint.insert(physicalArtwork).values({
                id,
                entryId: entry.id,
                competitionId: competition.id,
                artworkCode: code,
                status: decision.to,
                institutionRegistrationId: entry.institutionRegistrationId,
                registrationId: entry.registrationId,
                requestedBy,
                requestedAt: now,
                dispatchDeadline: decision.dispatchDeadline,
                ...told,
              });
              return code;
            })
        );
        await platform.recordAudit(tx, ctx, {
          action: "physical_artwork.requested",
          entity: { type: "physical_artwork", id },
          before: null,
          after: { status: decision.to, entryId: entry.id, artworkCode },
          actorRole: role,
        });
        const aggregate = { type: "physical_artwork", id } as const;
        await emit(tx, ctx.clock, {
          type: decision.event,
          aggregate,
          payload: { artworkId: id },
        });
        if (decision.reminderAt) {
          await emit(
            tx,
            ctx.clock,
            {
              type: "artwork.dispatch_reminder_due",
              aggregate,
              payload: { artworkId: id },
            },
            { availableAt: decision.reminderAt }
          );
        }
        artworks.push({
          artworkId: id,
          artworkCode,
          entryId: entry.id,
          dispatchDeadline: decision.dispatchDeadline,
        });
      }
      return { ok: true, artworks };
    }
  );
}
