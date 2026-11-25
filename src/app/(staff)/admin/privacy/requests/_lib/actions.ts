"use server";

import { redirect, RedirectType } from "next/navigation";

import { adminPrivacyRequestPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { adminCall } from "../../../_lib/boundary";
import { outcomeHref, outcomeOf, type OfficerOutcome } from "./outcome";

// The grievance officer's steps on one request (#115). Each runs its use
// case, which checks the officer (global grant and this session's second
// factor; a fresh one to carry out an erasure) and writes the audit row,
// then sends the officer back to the request with the outcome in its
// address. A second-factor refusal sends them to lift it first, then back.

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function officerStep(
  formData: FormData,
  step: (
    requestId: string,
    useCases: ReturnType<typeof as>
  ) => Promise<OfficerOutcome>
): Promise<never> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const requestId = text(formData, "requestId");
  const back = adminPrivacyRequestPath(requestId);
  const call = await adminCall(() => step(requestId, as(actor)), back);
  redirect(
    call.ok ? outcomeHref(requestId, call.value) : back,
    RedirectType.replace
  );
}

export async function startRequestAction(formData: FormData): Promise<void> {
  await officerStep(formData, async (id, useCases) =>
    outcomeOf(await useCases.startPrivacyRequest({ id }), "started")
  );
}

export async function assignRequestAction(formData: FormData): Promise<void> {
  await officerStep(formData, async (id, useCases) => {
    const result = await useCases.assignPrivacyRequest({
      id,
      assigneeUserId: text(formData, "assigneeUserId"),
    });
    return result.ok && !result.changed
      ? { kind: "result", key: "unchanged" }
      : outcomeOf(result, "assigned");
  });
}

export async function addNoteAction(formData: FormData): Promise<void> {
  await officerStep(formData, async (id, useCases) =>
    outcomeOf(
      await useCases.addPrivacyRequestNote({
        id,
        body: text(formData, "body"),
      }),
      "noted"
    )
  );
}

export async function rejectRequestAction(formData: FormData): Promise<void> {
  await officerStep(formData, async (id, useCases) =>
    outcomeOf(
      await useCases.rejectPrivacyRequest({
        id,
        reason: text(formData, "reason"),
      }),
      "rejected"
    )
  );
}

export async function completeCorrectionAction(
  formData: FormData
): Promise<void> {
  await officerStep(formData, async (id, useCases) =>
    outcomeOf(
      await useCases.completeCorrection({
        id,
        resolution: text(formData, "resolution"),
      }),
      "completed"
    )
  );
}

export async function buildExportAction(formData: FormData): Promise<void> {
  await officerStep(formData, async (id, useCases) =>
    outcomeOf(await useCases.buildSubjectExport({ id }), "export")
  );
}

export async function executeErasureAction(formData: FormData): Promise<void> {
  await officerStep(formData, async (id, useCases) =>
    outcomeOf(
      await useCases.executeErasure({
        id,
        fingerprint: text(formData, "fingerprint"),
      }),
      "erasure"
    )
  );
}
