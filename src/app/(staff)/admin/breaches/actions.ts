"use server";

import { redirect, RedirectType } from "next/navigation";

import { ADMIN_BREACHES, adminBreachPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor, type UseCases } from "@/server/app";
import type { NotifySubject } from "@/server/modules/breaches/notify";
import { istLocalToInstant } from "@/server/modules/competitions/domain/ist";

import { adminCall } from "../_lib/boundary";
import type { BreachDetailsState, BreachDraft } from "./_lib/details-state";
import { outcomeHref, type BreachOutcome } from "./_lib/outcome";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function draftFrom(formData: FormData): BreachDraft {
  return {
    title: text(formData, "title"),
    awareAt: text(formData, "awareAt"),
    severity: text(formData, "severity"),
    personalDataInvolved: formData.get("personalDataInvolved") === "on",
    minorsAffected: formData.get("minorsAffected") === "on",
    affectedCount: text(formData, "affectedCount"),
    impact: text(formData, "impact"),
  };
}

function detailsFrom({
  awareAt: _awareAt,
  affectedCount,
  ...details
}: BreachDraft) {
  const count = affectedCount.trim();
  return {
    ...details,
    affectedCount: /^\d+$/.test(count) ? Number(count) : Number.NaN,
  };
}

function subjectsFrom(formData: FormData): NotifySubject[] {
  return text(formData, "subjects")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.startsWith("user:")) {
        return { type: "user", id: entry.slice("user:".length).trim() };
      }
      if (entry.startsWith("profile:")) {
        return {
          type: "participant_profile",
          id: entry.slice("profile:".length).trim(),
        };
      }
      return { type: "email", address: entry };
    });
}

async function signedIn() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return as(actor);
}

// The use case authorizes each request. Only an outcome code and counts
// travel in the redirect, with no free text from the form.
async function changeBreach(
  breachId: string,
  run: (use: UseCases) => Promise<BreachOutcome>
) {
  const use = await signedIn();
  const path = adminBreachPath(breachId);
  const call = await adminCall(() => run(use), path);
  redirect(
    outcomeHref(path, call.ok ? call.value : { error: "forbidden" }),
    RedirectType.replace
  );
}

export async function recordBreachAction(
  previous: BreachDetailsState,
  formData: FormData
): Promise<BreachDetailsState> {
  const use = await signedIn();
  const draft = draftFrom(formData);
  const awareAt = istLocalToInstant(draft.awareAt);
  const call = await adminCall(
    () =>
      use.recordBreach({
        ...detailsFrom(draft),
        awareAt: awareAt.ok ? awareAt.at : Number.NaN,
      }),
    ADMIN_BREACHES
  );
  if (!call.ok) redirect(outcomeHref(ADMIN_BREACHES, { error: "forbidden" }));
  const result = call.value;
  if (!result.ok) {
    const awareInFuture = result.error === "aware_in_future";
    return {
      attempt: (previous?.attempt ?? 0) + 1,
      draft,
      invalidFields: awareInFuture ? ["awareAt"] : result.fields,
      awareInFuture,
    };
  }
  redirect(adminBreachPath(result.id));
}

export async function updateBreachAction(
  breachId: string,
  previous: BreachDetailsState,
  formData: FormData
): Promise<BreachDetailsState> {
  const path = adminBreachPath(breachId);
  const use = await signedIn();
  const draft = draftFrom(formData);
  const call = await adminCall(
    () =>
      use.updateBreach({
        breachId,
        ...detailsFrom(draft),
      }),
    path
  );
  if (!call.ok) redirect(outcomeHref(path, { error: "forbidden" }));
  if (!call.value.ok && call.value.error === "invalid_input") {
    return {
      attempt: (previous?.attempt ?? 0) + 1,
      draft,
      invalidFields: call.value.fields,
    };
  }
  redirect(
    outcomeHref(path, call.value.ok ? { done: "updated" } : call.value),
    RedirectType.replace
  );
}

export async function addBreachNoteAction(
  breachId: string,
  formData: FormData
): Promise<void> {
  await changeBreach(breachId, async (use) => {
    const result = await use.addBreachTimelineEvent({
      breachId,
      note: text(formData, "note"),
    });
    return result.ok ? { done: "note_added" } : result;
  });
}

export async function containBreachAction(breachId: string): Promise<void> {
  await changeBreach(breachId, async (use) => {
    const result = await use.containBreach({ breachId });
    return result.ok ? { done: "contained" } : result;
  });
}

export async function closeBreachAction(
  breachId: string,
  formData: FormData
): Promise<void> {
  await changeBreach(breachId, async (use) => {
    const result = await use.closeBreach({
      breachId,
      reason: text(formData, "reason"),
    });
    return result.ok ? { done: "closed" } : result;
  });
}

export async function notifyAffectedAction(
  breachId: string,
  formData: FormData
): Promise<void> {
  await changeBreach(breachId, async (use) => {
    const result = await use.notifyAffectedUsers({
      breachId,
      subjects: subjectsFrom(formData),
    });
    if (!result.ok) return result;
    return {
      done: "notices",
      queued: result.noticesQueued,
      unmatched: result.unmatchedEmails.length,
    };
  });
}

export async function notifyAllAction(
  breachId: string,
  formData: FormData
): Promise<void> {
  await changeBreach(breachId, async (use) => {
    if (formData.get("confirmAll") !== "on") return { error: "invalid_input" };
    const result = await use.notifyAffectedUsers({
      breachId,
      subjects: "all_users",
    });
    return result.ok ? { done: "all_queued" } : result;
  });
}

export async function retryPrincipalNoticesAction(
  breachId: string
): Promise<void> {
  await changeBreach(breachId, async (use) => {
    const result = await use.notifyAffectedUsers({
      breachId,
      subjects: "retry_pending",
    });
    return result.ok ? { done: "notices_retried" } : result;
  });
}

export async function notifyAuthorityAction(
  breachId: string,
  formData: FormData
): Promise<void> {
  await changeBreach(breachId, async (use) => {
    const result = await use.notifyAuthority({
      breachId,
      manualReference: text(formData, "manualReference"),
    });
    if (!result.ok) return result;
    return {
      done: result.channel === "email" ? "authority_email" : "authority_manual",
    };
  });
}
