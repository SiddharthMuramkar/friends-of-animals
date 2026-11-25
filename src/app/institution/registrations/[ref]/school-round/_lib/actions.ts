"use server";

import { redirect, RedirectType } from "next/navigation";

import { schoolRoundPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";
import { PANEL_MAX_MEMBERS } from "@/server/modules/school-round";

import {
  encodeProblems,
  roundError,
  roundOutcome,
  type RoundOutcome,
} from "./outcome";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function signedIn() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

/** Back to the round page saying what happened. */
function back(
  formData: FormData,
  outcome: RoundOutcome,
  extra: Record<string, string> = {}
): never {
  const query = new URLSearchParams({
    done: outcome,
    // New each time, so a second outcome in a row is announced too.
    n: Date.now().toString(36),
    ...extra,
  });
  redirect(
    `${schoolRoundPath(field(formData, "reference"), field(formData, "institutionId"))}&${query.toString()}`,
    RedirectType.replace
  );
}

function ref(formData: FormData) {
  return {
    institutionId: field(formData, "institutionId"),
    reference: field(formData, "reference"),
  };
}

function failed(name: string, error: unknown): RoundOutcome {
  const outcome = roundError(error);
  if (outcome === "failed") {
    console.error(`${name} failed: ${errorSummaryForLogs(error)}`);
  }
  return outcome;
}

/** Saves the panel (#89): every row with a name or a role. */
export async function recordPanelAction(formData: FormData) {
  const actor = await signedIn();
  const members = Array.from({ length: PANEL_MAX_MEMBERS + 1 }, (_, n) => ({
    fullName: field(formData, `fullName.${n}`),
    designation: field(formData, `designation.${n}`),
  })).filter((row) => row.fullName.trim() || row.designation.trim());
  let outcome: RoundOutcome;
  try {
    outcome = roundOutcome(
      await as(actor).recordPanel({ ...ref(formData), members }),
      "panel_saved"
    );
  } catch (error) {
    outcome = failed("recordPanel", error);
  }
  back(formData, outcome);
}

/** Saves one category's shortlist (#89): the ticked entries and positions. */
export async function saveShortlistAction(formData: FormData) {
  const actor = await signedIn();
  const categoryId = field(formData, "categoryId");
  const picks = formData
    .getAll("pick")
    .filter((value): value is string => typeof value === "string")
    .map((entryId) => {
      const position = field(formData, `position.${entryId}`);
      return {
        entryId,
        position: /^\d{1,3}$/.test(position) ? Number(position) : null,
      };
    });
  let outcome: RoundOutcome;
  let extra: Record<string, string> = {};
  try {
    const result = await as(actor).saveShortlist({
      ...ref(formData),
      categoryId,
      picks,
    });
    outcome = roundOutcome(result, "shortlist_saved");
    if (!result.ok && result.error === "shortlist_invalid") {
      extra = { cat: categoryId, pr: encodeProblems(result.problems) };
    }
  } catch (error) {
    outcome = failed("saveShortlist", error);
  }
  back(formData, outcome, extra);
}

/** Attests the judging and finalises the round (#89). */
export async function finaliseSchoolRoundAction(formData: FormData) {
  const actor = await signedIn();
  let outcome: RoundOutcome;
  try {
    outcome = roundOutcome(
      await as(actor).finaliseSchoolRound({
        ...ref(formData),
        judgingAttested: field(formData, "judgingAttested") === "yes",
      }),
      "finalised"
    );
  } catch (error) {
    outcome = failed("finaliseSchoolRound", error);
  }
  back(formData, outcome);
}
