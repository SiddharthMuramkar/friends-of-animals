import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { recordAudit } from "../../audit/record";
import { consentEvent, galleryItem, galleryPurge } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { emit } from "../../outbox/emit";
import type { Delivery, OutboxDeps } from "../../outbox/handlers";
import { noStoreCdnPurger } from "../../ports/cdn-purger";
import { readSetting } from "../settings/read";
import { retireGalleryItem } from "./curation";
import { galleryMediaPath, galleryPath } from "./read";
const minute = 60_000;
const actor = { kind: "system", process: "worker" } as const;
export async function requestGalleryPurge(
  ctx: Pick<OutboxDeps, "db" | "clock">,
  itemId: string,
  requestedAt: Date,
  consentEventId?: string
) {
  // One durable purge per item and withdrawal, even when the consumer
  // is delivered twice while the public item stays published (credit only).
  const id = consentEventId
    ? uuidv7(requestedAt, () =>
        createHash("sha256")
          .update(`gallery-purge:${itemId}:${consentEventId}`)
          .digest()
      )
    : uuidv7(ctx.clock.now());
  const duration = await readSetting(ctx.db, "gallery.withdrawalPurgeMinutes");
  const [inserted] = await ctx.db
    .insert(galleryPurge)
    .values({
      id,
      itemId,
      status: "pending",
      requestedAt,
      deadlineAt: new Date(requestedAt.getTime() + duration * minute),
    })
    .onConflictDoNothing()
    .returning({ id: galleryPurge.id });
  if (!inserted) return;
  await emit(ctx.db, ctx.clock, {
    type: "gallery.purge_requested",
    aggregate: { type: "gallery_purge", id },
    payload: { purgeId: id },
  });
}
/** Apply only the withdrawal that follows the grant on which this item was
 * curated. Re-granting consent alone never resurrects the old item. */
export async function withdrawGalleryConsent(
  deps: OutboxDeps,
  delivery: Delivery<"consent.withdrawn">
) {
  const { payload } = delivery;
  const competitionId = payload.competitionId;
  if (
    !competitionId ||
    !["public_display", "display_school", "display_city"].includes(
      payload.purpose
    )
  )
    return;
  await deps.db.transaction(async (tx) => {
    const [withdrawal] = await tx
      .select()
      .from(consentEvent)
      .where(
        and(
          eq(consentEvent.id, payload.consentEventId),
          eq(consentEvent.action, "withdrawn"),
          eq(consentEvent.subjectType, payload.subjectType),
          eq(consentEvent.subjectId, payload.subjectId),
          eq(consentEvent.competitionId, competitionId),
          eq(consentEvent.purpose, payload.purpose),
          eq(consentEvent.documentId, payload.documentId)
        )
      );
    if (!withdrawal) return;
    const items = await tx
      .select({ item: galleryItem, grant: consentEvent })
      .from(galleryItem)
      .innerJoin(consentEvent, eq(galleryItem.consentEventId, consentEvent.id))
      .where(
        and(
          eq(consentEvent.subjectType, payload.subjectType),
          eq(consentEvent.subjectId, payload.subjectId),
          eq(consentEvent.competitionId, competitionId),
          eq(consentEvent.documentId, payload.documentId),
          inArray(galleryItem.status, ["published", "draft", "hidden"])
        )
      )
      .for("update", { of: galleryItem });
    for (const { item, grant } of items) {
      const afterGrant =
        payload.subjectType === "participant_profile"
          ? withdrawal.id > grant.id
          : withdrawal.occurredAt > grant.occurredAt ||
            (+withdrawal.occurredAt === +grant.occurredAt &&
              withdrawal.id > grant.id);
      if (!afterGrant) continue;
      if (payload.purpose === "public_display")
        await retireGalleryItem(
          { ...deps, db: tx, actor },
          item,
          "unpublished",
          "consent_withdrawn",
          null,
          withdrawal.occurredAt
        );
      else if (item.status === "published")
        await requestGalleryPurge(
          { ...deps, db: tx },
          item.id,
          withdrawal.occurredAt,
          withdrawal.id
        );
    }
  });
}
/** The durable row and its deadline survive item deletion and worker restarts.
 * A failed remote purge never rolls back unpublication. No cache is used
 * on serving routes, so even a provider outage cannot expose the artwork. */
export async function runGalleryPurge(deps: OutboxDeps, purgeId: string) {
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(galleryPurge)
      .where(eq(galleryPurge.id, purgeId))
      .for("update");
    if (!row || row.status !== "pending") return;
    const now = deps.clock.now();
    const audit = async (action: string) =>
      recordAudit(
        tx,
        { ...deps, actor },
        {
          action,
          entity: { type: "gallery_purge", id: row.id },
          before: null,
          after: {
            itemId: row.itemId,
            deadlineAt: row.deadlineAt.toISOString(),
          },
          actorRole: null,
        }
      );
    const overdue = now >= row.deadlineAt;
    if (overdue && !row.overdueAlerted) {
      await audit("gallery.purge_overdue");
      await emit(tx, deps.clock, {
        type: "gallery.purge_overdue",
        aggregate: { type: "gallery_purge", id: row.id },
        payload: { purgeId: row.id },
      });
    }
    const paths = [
      "/",
      "/gallery",
      galleryPath(row.itemId),
      galleryMediaPath(row.itemId),
      `${galleryPath(row.itemId)}/report`,
      `/gallery-report/${row.itemId}`,
    ];
    try {
      await (deps.cdn ?? noStoreCdnPurger).purge(paths);
      await tx
        .update(galleryPurge)
        .set({
          status: "completed",
          attempts: row.attempts + 1,
          completedAt: deps.clock.now(),
          overdueAlerted: row.overdueAlerted || overdue,
        })
        .where(eq(galleryPurge.id, row.id));
    } catch {
      const hardDeadline = +row.requestedAt + 24 * 60 * minute;
      const exhausted = +now >= hardDeadline;
      await tx
        .update(galleryPurge)
        .set({
          status: exhausted ? "failed" : "pending",
          attempts: row.attempts + 1,
          overdueAlerted: row.overdueAlerted || overdue,
        })
        .where(eq(galleryPurge.id, row.id));
      if (exhausted) {
        await audit("gallery.purge_failed");
        await emit(tx, deps.clock, {
          type: "gallery.purge_failed",
          aggregate: { type: "gallery_purge", id: row.id },
          payload: { purgeId: row.id },
        });
        return;
      }
      const next = overdue
        ? Math.min(+now + 10 * minute, hardDeadline)
        : Math.min(
            +now + Math.min(2 ** row.attempts, 10) * minute,
            +row.deadlineAt
          );
      await emit(
        tx,
        deps.clock,
        {
          type: "gallery.purge_requested",
          aggregate: { type: "gallery_purge", id: row.id },
          payload: { purgeId: row.id },
        },
        { availableAt: new Date(next) }
      );
    }
  });
}
