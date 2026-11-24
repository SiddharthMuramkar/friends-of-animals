"use server";

// The campaign pages' Server Actions. Each reads who is acting, reads the
// form and calls one use case, which checks `can()` itself. A change that
// worked redirects to the campaign's page with `?done=…`; the composer's
// refusals come back as its next view, so nothing typed is lost.

import { redirect } from "next/navigation";
import { z } from "zod";

import { ADMIN_CAMPAIGNS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";

import {
  draftInput,
  formValues,
  refusedView,
  type CampaignFormView,
} from "./form";
import { campaignHref, type Refusal } from "./href";

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

const revisionOf = (form: FormData) =>
  z.coerce.number().int().positive().safeParse(text(form, "revision"));

/** Creates a draft, or saves one. Returns the next view when refused. */
export async function saveCampaignAction(
  _previous: CampaignFormView,
  form: FormData
): Promise<CampaignFormView> {
  const actor = await signedInActor();
  const values = formValues(form);
  const campaignId = text(form, "campaignId");

  if (campaignId === "") {
    const created = await orForbidden(() =>
      as(actor).createCampaign(draftInput(values))
    );
    if (!created.ok) {
      return refusedView(
        values,
        created.error === "invalid_input"
          ? { fields: created.fields }
          : { code: created.error }
      );
    }
    redirect(
      campaignHref(created.campaign.id, { done: "created" }, Date.now())
    );
  }

  const id = z.uuid().safeParse(campaignId);
  const revision = revisionOf(form);
  if (!id.success || !revision.success) redirect(ADMIN_CAMPAIGNS);
  const saved = await orForbidden(() =>
    as(actor).updateCampaign({
      id: id.data,
      revision: revision.data,
      ...draftInput(values),
    })
  );
  if (!saved.ok) {
    return refusedView(
      values,
      saved.error === "invalid_input"
        ? { fields: saved.fields }
        : { code: saved.error }
    );
  }
  redirect(campaignHref(id.data, { done: "saved" }, Date.now()));
}

/** Sends a draft after the community manager confirms the send. */
export async function sendCampaignAction(form: FormData): Promise<void> {
  const actor = await signedInActor();
  const id = z.uuid().safeParse(text(form, "campaignId"));
  if (!id.success) redirect(ADMIN_CAMPAIGNS);
  const back = (outcome: { done: "sent" } | { refused: Refusal }) =>
    redirect(campaignHref(id.data, outcome, Date.now()));

  const revision = revisionOf(form);
  if (text(form, "confirm") !== "yes" || !revision.success) {
    return back({ refused: "unconfirmed" });
  }
  const sent = await orForbidden(() =>
    as(actor).sendCampaign({ id: id.data, revision: revision.data })
  );
  if (!sent.ok) {
    if (sent.error === "not_found") redirect(ADMIN_CAMPAIGNS);
    back({ refused: sent.error });
  }
  back({ done: "sent" });
}
