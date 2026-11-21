"use server";

import { getTranslations } from "next-intl/server";
import { updateTag } from "next/cache";
import { redirect, RedirectType } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { Actor } from "@/server/actor";
import { DomainError } from "@/server/errors";
import { COMPETITION_TAGS } from "@/server/modules/competitions";

import { fieldsFromForm } from "./form-data";
import type { CompetitionFormView } from "./form-state";
import { refusalOutcome, type FieldName, type SaveRefusal } from "./form-view";
import { competitionHref } from "./href";
import { translate } from "./translate";

/** Whether a use case threw because the policy refused the actor. */
function isRefusal(error: unknown): boolean {
  return error instanceof DomainError && error.code === "forbidden";
}

async function signedInActor(): Promise<Extract<Actor, { kind: "user" }>> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

/** The form again, with what was typed and why the save was refused. */
async function refusedView(
  previous: CompetitionFormView,
  values: CompetitionFormView["values"],
  refusal: SaveRefusal | "refused"
): Promise<CompetitionFormView> {
  const t = await getTranslations("adminCompetitions");
  if (refusal === "refused") {
    return {
      attempt: previous.attempt + 1,
      values,
      alert: t("alerts.refused"),
      errors: {},
    };
  }
  const outcome = refusalOutcome(refusal);
  const errors: CompetitionFormView["errors"] = {};
  for (const [field, messages] of Object.entries(outcome.errors)) {
    errors[field as FieldName] = messages
      .map((message) => translate(t, message))
      .join(" ");
  }
  return {
    attempt: previous.attempt + 1,
    values,
    alert: t(`alerts.${outcome.alert}`),
    errors,
  };
}

/** The token that makes a repeated "done" notice announce again. */
const token = () => Date.now().toString(36);

/** Saves a new draft, then opens it in the edit form. */
export async function createCompetitionAction(
  previous: CompetitionFormView,
  formData: FormData
): Promise<CompetitionFormView> {
  const actor = await signedInActor();
  const fields = fieldsFromForm(formData);
  let result;
  try {
    result = await as(actor).createCompetition(fields);
  } catch (error) {
    if (!isRefusal(error)) throw error;
    return refusedView(previous, fields, "refused");
  }
  if (!result.ok) return refusedView(previous, fields, result);
  // A draft is on no public page, so no cache tag changes.
  redirect(
    competitionHref(result.competition.id, "edit", {
      done: "created",
      at: token(),
    })
  );
}

/**
 * Saves the edit form. A published competition's public pages show the
 * change at once: the list and its page are read fresh.
 */
export async function updateCompetitionAction(
  target: { competitionId: string; slug: string },
  previous: CompetitionFormView,
  formData: FormData
): Promise<CompetitionFormView> {
  const actor = await signedInActor();
  const fields = fieldsFromForm(formData);
  let result;
  try {
    result = await as(actor).updateCompetition({
      competitionId: target.competitionId,
      ...fields,
    });
  } catch (error) {
    if (!isRefusal(error)) throw error;
    return refusedView(previous, fields, "refused");
  }
  if (!result.ok) return refusedView(previous, fields, result);
  if (result.changed) {
    updateTag(COMPETITION_TAGS.list);
    updateTag(COMPETITION_TAGS.slug(target.slug));
  }
  redirect(
    competitionHref(target.competitionId, "edit", {
      done: "saved",
      at: token(),
    }),
    RedirectType.replace
  );
}

/**
 * Publishes the competition from its preview, then shows the preview
 * again: published, or with what still stops it.
 */
export async function publishCompetitionAction(
  competitionId: string,
  _formData: FormData
): Promise<void> {
  const actor = await signedInActor();
  let result;
  try {
    result = await as(actor).publishCompetition({ competitionId });
  } catch (error) {
    if (!isRefusal(error)) throw error;
    redirect(competitionHref(competitionId, "preview", { refused: "refused" }));
  }
  if (!result.ok) {
    redirect(
      competitionHref(competitionId, "preview", { refused: result.error }),
      RedirectType.replace
    );
  }
  updateTag(COMPETITION_TAGS.list);
  updateTag(COMPETITION_TAGS.slug(result.competition.slug));
  redirect(
    competitionHref(competitionId, "preview", {
      done: "published",
      at: token(),
    }),
    RedirectType.replace
  );
}
