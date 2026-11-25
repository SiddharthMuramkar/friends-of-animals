import { and, eq, inArray, ne, type AnyColumn } from "drizzle-orm";
import { z } from "zod";
import { authorize } from "../../access/can";
import type { Action } from "../../access/policies";
import {
  competition,
  institution,
  paymentBatch,
  physicalArtwork,
  refund,
  resultRelease,
  safeguardingReport,
} from "../../db/schema";
import { DomainError } from "../../errors";
import { invalidInput } from "../../input";
import type { UseCaseContext } from "../../use-cases";
import { listVerificationQueue } from "../verification/use-cases/list-verification-queue";
import { withLead } from "../safeguarding/with-lead";
import { queueViewAuditSnapshot } from "../safeguarding/domain/audit";
import { reportScope, type CompetitionScope } from "./scope";

export type QueueItem = {
  id: string;
  code: string;
  competitionCode: string | null;
  waitingSince: Date;
  href: string;
  overdue?: boolean;
  mine?: boolean;
};

type QueueDefinition = {
  read: Action;
  work: Action;
  scoped?: boolean;
  workHref: string;
  rows(ctx: UseCaseContext, scope: CompetitionScope): Promise<QueueItem[]>;
};

function restrict(column: AnyColumn, scope: CompetitionScope) {
  return scope === "all" ? undefined : inArray(column, [...scope]);
}

// Project only the codes and dates needed to navigate to the owning
// module's work screens. This registry also drives the complete fallback
// lists (including a keyset page for work screens with capped lists).
export const QUEUES = {
  institutions_to_verify: {
    read: "institution.list",
    work: "institution.decide",
    workHref: "/admin/institutions?status=pending_verification",
    async rows(ctx) {
      const rows = await ctx.db
        .select({
          id: institution.id,
          code: institution.name,
          waitingSince: institution.createdAt,
        })
        .from(institution)
        .where(eq(institution.status, "pending_verification"));
      return rows.map((row) => ({
        ...row,
        competitionCode: null,
        href: `/admin/institutions/${row.id}`,
      }));
    },
  },
  entries_to_verify: {
    read: "verification.read",
    work: "verification.decide",
    workHref: "/admin/verification",
    async rows(ctx) {
      // The verifier queue excludes cancelled competitions, unconfirmed
      // registrations, pending replacement files and entries with no arrival.
      const result = await listVerificationQueue(ctx, {});
      if (!result.ok) throw new Error("Invalid verification queue");
      return result.items.map((row) => ({
        id: row.entryId,
        code: row.code,
        competitionCode: row.competition.code,
        waitingSince: row.arrivedAt,
        href: `/admin/verification/${row.entryId}`,
      }));
    },
  },
  artwork_arriving: {
    read: "artwork.read",
    work: "artwork.receive",
    scoped: true,
    workHref: "/admin/artwork",
    async rows(ctx, scope) {
      const rows = await ctx.db
        .select({
          id: physicalArtwork.id,
          code: physicalArtwork.artworkCode,
          competitionCode: competition.code,
          waitingSince: physicalArtwork.requestedAt,
          status: physicalArtwork.status,
          dispatchDeadline: physicalArtwork.dispatchDeadline,
        })
        .from(physicalArtwork)
        .innerJoin(
          competition,
          eq(competition.id, physicalArtwork.competitionId)
        )
        .where(
          and(
            inArray(physicalArtwork.status, ["requested", "dispatched"]),
            restrict(physicalArtwork.competitionId, scope)
          )
        );
      const now = ctx.clock.now();
      return rows.map(({ status, dispatchDeadline, ...row }) => ({
        ...row,
        overdue: status === "requested" && now > dispatchDeadline,
        href: `/admin/artwork/${row.code}`,
      }));
    },
  },
  results_to_approve: {
    read: "results.read",
    work: "results.approve",
    scoped: true,
    workHref: "/admin/competitions",
    async rows(ctx, scope) {
      const rows = await ctx.db
        .select({
          id: resultRelease.id,
          code: competition.code,
          competitionId: competition.id,
          waitingSince: resultRelease.preparedAt,
          preparedBy: resultRelease.preparedByUserId,
        })
        .from(resultRelease)
        .innerJoin(competition, eq(competition.id, resultRelease.competitionId))
        .where(
          and(
            eq(resultRelease.status, "pending_approval"),
            restrict(resultRelease.competitionId, scope)
          )
        );
      return rows.map(({ competitionId, preparedBy, ...row }) => ({
        ...row,
        competitionCode: row.code,
        mine: ctx.actor.kind === "user" && preparedBy === ctx.actor.userId,
        href: `/admin/competitions/${competitionId}/results`,
      }));
    },
  },
  refunds_to_approve: {
    read: "refunds.read",
    work: "refunds.decide",
    workHref: "/admin/refunds?state=waiting",
    async rows(ctx) {
      const rows = await ctx.db
        .select({
          id: refund.id,
          competitionCode: competition.code,
          waitingSince: refund.requestedAt,
          requestedBy: refund.requestedBy,
        })
        .from(refund)
        .innerJoin(paymentBatch, eq(paymentBatch.id, refund.batchId))
        .leftJoin(competition, eq(competition.id, paymentBatch.competitionId))
        .where(
          and(
            eq(refund.status, "requested"),
            inArray(paymentBatch.purpose, ["registration_fee", "auction_sale"])
          )
        );
      return rows.map(({ requestedBy, ...row }) => ({
        ...row,
        code: row.id,
        mine: ctx.actor.kind === "user" && requestedBy === ctx.actor.userId,
        href: `/admin/refunds/${row.id}`,
      }));
    },
  },
  safeguarding_reports_to_review: {
    read: "safeguarding.list",
    work: "safeguarding.view",
    workHref: "/admin/safeguarding?view=open",
    async rows(ctx) {
      // Even a read of report references/counts is restricted and audited
      // through the safeguarding module itself.
      return withLead(ctx, "safeguarding.list", async (tx) => {
        const rows = await tx
          .select({
            id: safeguardingReport.id,
            code: safeguardingReport.reference,
            waitingSince: safeguardingReport.createdAt,
          })
          .from(safeguardingReport)
          .where(ne(safeguardingReport.status, "resolved"));
        return {
          result: rows.map((row) => ({
            ...row,
            competitionCode: null,
            href: `/admin/safeguarding/${row.id}`,
          })),
          audit: {
            action: "safeguarding.queue_viewed",
            entity: { type: "safeguarding_queue", id: "open" },
            before: null,
            after: queueViewAuditSnapshot(rows.length),
          },
        };
      });
    },
  },
} satisfies Record<string, QueueDefinition>;

export type QueueKey = keyof typeof QUEUES;
export const QUEUE_KEYS = Object.keys(QUEUES) as QueueKey[];
const queueDefinition = (key: QueueKey): QueueDefinition => QUEUES[key];

async function visibleScope(ctx: UseCaseContext, def: QueueDefinition) {
  return reportScope(ctx, def.read, def.work, def.scoped ?? false);
}

function order(
  a: Pick<QueueItem, "waitingSince" | "id">,
  b: Pick<QueueItem, "waitingSince" | "id">
) {
  return (
    a.waitingSince.getTime() - b.waitingSince.getTime() ||
    a.id.localeCompare(b.id)
  );
}

export async function getAdminHome(ctx: UseCaseContext) {
  await authorize(ctx, "admin_home.view");
  const queues = [];
  for (const key of QUEUE_KEYS) {
    const def = queueDefinition(key);
    const scope = await visibleScope(ctx, def);
    if (scope !== "all" && scope.length === 0) continue;
    const items = (await def.rows(ctx, scope)).sort(order);
    queues.push({
      key,
      count: items.length,
      oldestWaitingSince: items[0]?.waitingSince ?? null,
      ...(key === "artwork_arriving"
        ? { overdue: items.filter((i) => i.overdue).length }
        : {}),
      href: `/admin/queues/${key}`,
      workHref: def.workHref,
    });
  }
  return { queues };
}

const cursorSchema = z.tuple([z.iso.datetime(), z.uuid()]);
const listInput = z.object({
  key: z.enum(QUEUE_KEYS),
  cursor: z.string().max(200).optional(),
  limit: z.int().min(1).max(100).default(50),
});
export type ListQueueItemsInput = z.input<typeof listInput>;

export async function listQueueItems(
  ctx: UseCaseContext,
  input: ListQueueItemsInput
) {
  await authorize(ctx, "admin_home.view");
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { key, cursor, limit } = parsed.data;
  const def = queueDefinition(key);
  const scope = await visibleScope(ctx, def);
  if (scope !== "all" && scope.length === 0)
    throw new DomainError("forbidden", "Queue is not available to this actor");
  let after: Pick<QueueItem, "waitingSince" | "id"> | undefined;
  if (cursor) {
    try {
      const [date, id] = cursorSchema.parse(
        JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
      );
      after = { waitingSince: new Date(date), id };
    } catch {
      return { ok: false, error: "invalid_input", fields: ["cursor"] } as const;
    }
  }
  const all = (await def.rows(ctx, scope)).sort(order);
  const matching = after ? all.filter((row) => order(row, after!) > 0) : all;
  const items = matching.slice(0, limit);
  const last = items.at(-1);
  const nextCursor =
    matching.length > limit && last
      ? Buffer.from(
          JSON.stringify([last.waitingSince.toISOString(), last.id])
        ).toString("base64url")
      : null;
  return {
    ok: true,
    items,
    nextCursor,
    count: all.length,
    workHref: def.workHref,
  } as const;
}
