"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import type { Actor } from "@/server/actor";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import { COMPETITION_TAGS } from "@/server/modules/competitions/cache-tags";
import { PARTICIPATION_ROUTES } from "@/server/modules/competitions/domain/fees";

import {
  afterSetFees,
  afterSetRoundAwards,
  type AwardsFormState,
  type FeesEntered,
  type FeesFormState,
  secondFactorRedirect,
} from "./form-state";
import { competitionTermsPath } from "./paths";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function signedIn(): Promise<Actor> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

/** Shows the change on the competition's public page on the next request. */
async function refreshPublicPage(actor: Actor, competitionId: string) {
  const read = await as(actor).getCompetitionTermsForEdit({ competitionId });
  if (read.ok) updateTag(COMPETITION_TAGS.slug(read.terms.competition.slug));
}

/**
 * The fees form: free for everyone, or a fee per offered route. Fees are
 * money, so a manager whose second factor is too old steps up (#60) and
 * comes back to save again.
 */
export async function saveFeesAction(
  _previous: FeesFormState | null,
  formData: FormData
): Promise<FeesFormState> {
  const actor = await signedIn();
  const competitionId = field(formData, "competitionId");
  const entered: FeesEntered = {
    mode: field(formData, "mode") === "free" ? "free" : "paid",
    fees: Object.fromEntries(
      PARTICIPATION_ROUTES.flatMap((route) =>
        formData.has(`fee-${route}`)
          ? [[route, field(formData, `fee-${route}`)]]
          : []
      )
    ),
  };
  try {
    const result = await as(actor).setCompetitionFees(
      entered.mode === "free"
        ? { competitionId, free: true }
        : { competitionId, fees: entered.fees, currency: "INR" }
    );
    if (result.ok && result.changed) {
      await refreshPublicPage(actor, competitionId);
    }
    return afterSetFees(result, entered);
  } catch (error) {
    // redirect() throws; from the catch block, this try doesn't catch it.
    const lift = secondFactorRedirect(error, competitionId);
    if (lift) redirect(lift);
    console.error(
      `Competition fees form: the use case failed: ${errorSummaryForLogs(error)}`
    );
    return { entered, alert: "failed", fieldErrors: {} };
  }
}

/** One round's awards form: its scheme and a prize per band. */
export async function saveRoundAwardsAction(
  _previous: AwardsFormState | null,
  formData: FormData
): Promise<AwardsFormState> {
  const actor = await signedIn();
  const competitionId = field(formData, "competitionId");
  const prizes: Record<string, string> = {};
  for (const [name, value] of formData) {
    if (name.startsWith("prize-") && typeof value === "string") {
      prizes[name.slice("prize-".length)] = value;
    }
  }
  const entered = { scheme: field(formData, "scheme"), prizes };
  try {
    const result = await as(actor).setRoundAwards({
      competitionId,
      roundKey: field(formData, "roundKey"),
      ...entered,
    });
    if (result.ok && result.changed) {
      await refreshPublicPage(actor, competitionId);
    }
    return afterSetRoundAwards(result, entered);
  } catch (error) {
    const lift = secondFactorRedirect(error, competitionId);
    if (lift) redirect(lift);
    console.error(
      `Competition awards form: the use case failed: ${errorSummaryForLogs(error)}`
    );
    return { entered, error: "failed" };
  }
}

/**
 * Attach (or move to the latest version) or detach one purpose's
 * document, then back to the page, which shows the new pin.
 */
export async function documentAction(formData: FormData): Promise<void> {
  const actor = await signedIn();
  const competitionId = field(formData, "competitionId");
  const input = { competitionId, purpose: field(formData, "purpose") };
  let outcome: "saved" | "failed" = "failed";
  try {
    const result =
      field(formData, "intent") === "detach"
        ? await as(actor).detachConsentDocument(input)
        : await as(actor).attachConsentDocument(input);
    if (result.ok) {
      outcome = "saved";
      if (result.changed) await refreshPublicPage(actor, competitionId);
    }
  } catch (error) {
    const lift = secondFactorRedirect(error, competitionId);
    if (lift) redirect(lift);
    console.error(
      `Competition documents form: the use case failed: ${errorSummaryForLogs(error)}`
    );
  }
  redirect(`${competitionTermsPath(competitionId)}?documents=${outcome}`);
}
