"use server";

// The announcement pages' Server Actions. Each one reads who is acting,
// reads the form, and calls one use case, which checks `can()` itself. A
// change that worked redirects to the announcement's page with `?done=…`;
// the composer's refusals come back as its next view, so nothing typed is
// lost.

import { redirect } from "next/navigation";
import { z } from "zod";

import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";

import {
  formValues,
  formViewForRefusal,
  readAnnouncementForm,
  type AnnouncementFormView,
} from "./form";
import { announcementHref, announcementsHref, type Refusal } from "./href";

const ids = z.object({
  competitionId: z.uuid(),
  announcementId: z.uuid().or(z.literal("")),
});

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
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

/**
 * Creates a draft, or saves one's content. Returns the composer's next
 * view when something is refused.
 */
export async function saveAnnouncementAction(
  _previous: AnnouncementFormView,
  form: FormData
): Promise<AnnouncementFormView> {
  const actor = await signedInActor();
  const target = ids.safeParse({
    competitionId: text(form, "competitionId"),
    announcementId: text(form, "announcementId"),
  });
  if (!target.success) redirect(ROUTES.home.path);
  const { competitionId, announcementId } = target.data;

  const read = readAnnouncementForm(form);
  if (!read.ok) return formViewForRefusal(read.values, read.fields);
  const typed = formValues(form);

  if (announcementId === "") {
    const created = await orForbidden(() =>
      as(actor).createAnnouncement({ competitionId, content: read.content })
    );
    if (!created.ok) {
      return formViewForRefusal(
        typed,
        created.error === "invalid_input" ? created.fields : [created.error]
      );
    }
    redirect(
      announcementHref(
        competitionId,
        created.announcement.id,
        { done: "created" },
        Date.now()
      )
    );
  }

  const saved = await orForbidden(() =>
    as(actor).updateAnnouncement({
      competitionId,
      id: announcementId,
      content: read.content,
    })
  );
  if (!saved.ok) {
    return formViewForRefusal(
      typed,
      saved.error === "invalid_input" ? saved.fields : [saved.error]
    );
  }
  redirect(
    announcementHref(
      competitionId,
      announcementId,
      { done: "saved" },
      Date.now()
    )
  );
}

/** Sends a draft after the manager confirms the send. */
export async function sendAnnouncementAction(form: FormData): Promise<void> {
  const actor = await signedInActor();
  const target = ids.safeParse({
    competitionId: text(form, "competitionId"),
    announcementId: text(form, "announcementId"),
  });
  if (!target.success || target.data.announcementId === "") {
    redirect(ROUTES.home.path);
  }
  const { competitionId, announcementId } = target.data;
  const back = (outcome: { done: "sent" } | { refused: Refusal }) =>
    redirect(
      announcementHref(competitionId, announcementId, outcome, Date.now())
    );

  const revision = z
    .int()
    .positive()
    .safeParse(Number(text(form, "revision")));
  if (text(form, "confirm") !== "yes" || !revision.success) {
    return back({ refused: "unconfirmed" });
  }
  const sent = await orForbidden(() =>
    as(actor).sendAnnouncement({
      competitionId,
      id: announcementId,
      revision: revision.data,
    })
  );
  if (!sent.ok) {
    if (sent.error === "not_found") redirect(announcementsHref(competitionId));
    back({ refused: sent.error });
  }
  back({ done: "sent" });
}
