"use server";

// The rubric pages' Server Actions. Each one reads who is acting, reads
// the form, and calls one use case, which checks `can()` itself. A change
// that worked redirects back to the discipline's page with `?done=…`; the
// editor's refusals come back as its next view, so nothing typed is lost.

import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { DISCIPLINES } from "@/server/modules/competitions/domain/vocabulary";
import type { RubricProblem } from "@/server/modules/judging";

import { parseCriteriaForm } from "./criteria-form";
import {
  editorRows,
  weightTotal,
  type EditorRow,
  type RubricEditorView,
} from "./editor-view";
import { disciplineRubricHref, REFUSALS, type Refusal } from "./href";

const target = z.object({
  competitionId: z.uuid(),
  discipline: z.enum(DISCIPLINES),
});

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function readTarget(form: FormData) {
  return target.safeParse({
    competitionId: text(form, "competitionId"),
    discipline: text(form, "discipline"),
  });
}

async function signedInActor() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

/** Runs a use case; a policy refusal comes back as `forbidden`. */
async function orForbidden<T>(
  run: () => Promise<T>
): Promise<T | { ok: false; error: "forbidden" }> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") {
      return { ok: false, error: "forbidden" };
    }
    throw error;
  }
}

function asRefusal(error: string): Refusal {
  return (REFUSALS as readonly string[]).includes(error)
    ? (error as Refusal)
    : "invalid_input";
}

/** Starts a discipline's first rubric, from FOA's judging guide. */
export async function startRubricAction(form: FormData): Promise<void> {
  const actor = await signedInActor();
  const parsed = readTarget(form);
  if (!parsed.success) redirect(ROUTES.home.path);
  const { competitionId, discipline } = parsed.data;
  const result = await orForbidden(() =>
    as(actor).createRubricDraft({ competitionId, discipline })
  );
  redirect(
    disciplineRubricHref(
      competitionId,
      discipline,
      result.ok ? { done: "created" } : { refused: asRefusal(result.error) },
      Date.now()
    )
  );
}

/** Starts the next version of the published rubric. */
export async function reviseRubricAction(form: FormData): Promise<void> {
  const actor = await signedInActor();
  const parsed = readTarget(form);
  if (!parsed.success) redirect(ROUTES.home.path);
  const { competitionId, discipline } = parsed.data;
  const rubricId = text(form, "rubricId");
  const result = await orForbidden(() =>
    as(actor).startRubricRevision({ rubricId })
  );
  redirect(
    disciplineRubricHref(
      competitionId,
      discipline,
      result.ok ? { done: "revision" } : { refused: asRefusal(result.error) },
      Date.now()
    )
  );
}

/**
 * Saves the draft's criteria and, for "Save and publish", publishes it.
 * Returns the editor's next view when something is refused.
 */
export async function saveRubricAction(
  _previous: RubricEditorView,
  form: FormData
): Promise<RubricEditorView> {
  const actor = await signedInActor();
  const t = await getTranslations("adminRubrics");
  const parsed = readTarget(form);
  if (!parsed.success) return { alert: t("refusals.invalid_input"), rows: [] };
  const { competitionId, discipline } = parsed.data;
  const rubricId = text(form, "rubricId");
  const publish = text(form, "intent") === "publish";
  const criteria = parseCriteriaForm(form);

  const withTotal = (view: { rows: EditorRow[] } & RubricEditorView) => ({
    ...view,
    total: t("editor.total", { total: weightTotal(view.rows) }),
  });

  if (!criteria.ok) {
    return withTotal({
      alert: criteria.tooMany ? t("editor.tooMany") : t("editor.fixFields"),
      rows: editorRows(
        criteria.rows.map(({ values, errors }) => ({
          values,
          errors: Object.fromEntries(
            Object.entries(errors).map(([field, problem]) => [
              field,
              t(`editor.errors.${problem}`),
            ])
          ),
        }))
      ),
    });
  }

  const keep = (alert: string, details?: string[]): RubricEditorView =>
    withTotal({
      alert,
      details,
      rows: editorRows(
        criteria.criteria.map((criterion) => ({
          values: {
            label: criterion.label,
            description: criterion.description,
            weight: String(criterion.weight),
            minScore: String(criterion.minScore),
            maxScore: String(criterion.maxScore),
          },
          errors: {},
        }))
      ),
    });

  const saved = await orForbidden(() =>
    as(actor).updateRubricDraft({ rubricId, criteria: criteria.criteria })
  );
  if (!saved.ok) return keep(t(`refusals.${saved.error}`));
  if (!publish) {
    redirect(
      disciplineRubricHref(
        competitionId,
        discipline,
        { done: "saved" },
        Date.now()
      )
    );
  }

  const published = await orForbidden(() =>
    as(actor).publishRubric({ rubricId })
  );
  if (!published.ok) {
    if (published.error === "not_publishable") {
      return keep(
        t("editor.problem"),
        published.problems.map((problem: RubricProblem) =>
          problem.code === "weights_total"
            ? t("refusals.weights_total", { total: problem.total })
            : t("refusals.no_criteria")
        )
      );
    }
    return keep(t(`refusals.${published.error}`));
  }
  redirect(
    disciplineRubricHref(
      competitionId,
      discipline,
      { done: "published" },
      Date.now()
    )
  );
}
