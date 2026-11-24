// Previewing and publishing a draft (#70).
//
//   previewCompetition({ competitionId })  → a manager covering it
//   publishCompetition({ competitionId })  → a manager covering it
//
// Publishing refuses until publishProblems finds nothing, so every
// published competition has what the public page needs. It also saves a
// status job for each key date (#71), so the schedule moves the status on
// from there, and tells the reminders module (#84) to plan its reminders.
// Loads under plain Node: relative imports only.

import { eq } from "drizzle-orm";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { competition } from "../../db/schema";
import { emit } from "../../outbox/emit";
import { publishProblems, type PublishProblem } from "./domain/publish-rules";
import { statusJobs } from "./domain/status-schedule";
import type { CompetitionStatus } from "./domain/vocabulary";
import {
  competitionResource,
  isCompetitionId,
  type CompetitionsContext,
} from "./manage";
import { toPublicCompetition } from "./public-view";
import type { PublishedCompetition } from "./read-model";
import { saveStatusJobs } from "./status-jobs";
import { loadCompetition } from "./store";
import { publicCompetitionTerms } from "./terms/read";

export type PreviewCompetitionResult =
  | {
      ok: true;
      status: CompetitionStatus;
      /** What stops it being published; empty when nothing does. */
      problems: PublishProblem[];
      /**
       * The public page's view as it would be if published now, its terms
       * (#72) included, or null while there are problems.
       */
      competition: PublishedCompetition | null;
    }
  | { ok: false; error: "not_found" };

/** The competition as the public page will show it, or what it still needs. */
export async function previewCompetition(
  ctx: CompetitionsContext,
  input: { competitionId: string }
): Promise<PreviewCompetitionResult> {
  await authorize(
    ctx,
    "competition.preview",
    competitionResource(input.competitionId)
  );
  if (!isCompetitionId(input.competitionId)) {
    return { ok: false, error: "not_found" };
  }
  const stored = await loadCompetition(ctx.db, input.competitionId);
  if (!stored) return { ok: false, error: "not_found" };
  const { row, values } = stored;
  const problems = publishProblems(values);
  if (problems.length > 0) {
    return { ok: true, status: row.status, problems, competition: null };
  }
  const view = toPublicCompetition(
    {
      id: row.id,
      slug: row.slug,
      status: row.status === "draft" ? "published" : row.status,
      publishedAt: row.publishedAt ?? ctx.clock.now(),
    },
    values
  );
  return {
    ok: true,
    status: row.status,
    problems,
    competition: view && {
      ...view,
      terms: await publicCompetitionTerms(ctx.db, view),
    },
  };
}

export type PublishCompetitionResult =
  | {
      ok: true;
      competition: {
        id: string;
        code: string;
        slug: string;
        status: "published";
        publishedAt: Date;
      };
    }
  | { ok: false; error: "not_found" | "not_draft" }
  | { ok: false; error: "not_ready"; problems: PublishProblem[] };

/**
 * Publishes a draft, so the public pages show it. Refused while
 * publishProblems names anything (`not_ready`, every problem listed), and
 * for a competition already published (`not_draft`).
 */
export async function publishCompetition(
  ctx: CompetitionsContext,
  input: { competitionId: string }
): Promise<PublishCompetitionResult> {
  const { competitionId } = input;
  const { role: actorRole } = await authorize(
    ctx,
    "competition.publish",
    competitionResource(competitionId)
  );
  if (!isCompetitionId(competitionId)) {
    return { ok: false, error: "not_found" };
  }
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const stored = await loadCompetition(tx, competitionId, { lock: true });
    if (!stored) return { ok: false, error: "not_found" } as const;
    const { row, values } = stored;
    if (row.status !== "draft")
      return { ok: false, error: "not_draft" } as const;
    const problems = publishProblems(values);
    if (problems.length > 0) {
      return { ok: false, error: "not_ready", problems } as const;
    }

    await tx
      .update(competition)
      .set({ status: "published", publishedAt: now, updatedAt: now })
      .where(eq(competition.id, competitionId));
    await recordAudit(tx, ctx, {
      action: "competition.published",
      entity: { type: "competition", id: competitionId },
      before: { status: row.status, publishedAt: null },
      after: { status: "published", publishedAt: now.toISOString() },
      actorRole,
    });
    await saveStatusJobs(
      tx,
      ctx.clock,
      competitionId,
      statusJobs("published", values.keyDates)
    );
    await emit(tx, ctx.clock, {
      type: "competition.published",
      aggregate: { type: "competition", id: competitionId },
      payload: { competitionId },
    });
    return {
      ok: true,
      competition: {
        id: competitionId,
        code: row.code,
        slug: row.slug,
        status: "published",
        publishedAt: now,
      },
    } as const;
  });
}
