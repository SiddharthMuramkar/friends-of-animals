"use server";

import { redirect, RedirectType } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { ReportAction } from "@/server/modules/safeguarding";

import { adminCall } from "../../_lib/boundary";
import {
  outcomeHref,
  outcomeOfAssign,
  outcomeOfMove,
  outcomeOfNote,
  reportHref,
  type LeadOutcome,
} from "./outcome";

// The lead's steps on one report (#116). Each runs its use case, which
// checks the lead (global grant and this session's second factor) and
// writes the audit row, then sends the lead back to the report with the
// outcome in its address (./outcome.ts). A second-factor refusal sends the
// lead to lift it first, then back to the report; any other refusal lands
// on the report page, which explains it.

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function leadStep(
  formData: FormData,
  step: (
    reportId: string,
    useCases: ReturnType<typeof as>
  ) => Promise<LeadOutcome>
): Promise<never> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const reportId = text(formData, "reportId");
  const back = reportHref(reportId);
  const call = await adminCall(() => step(reportId, as(actor)), back);
  redirect(
    call.ok ? outcomeHref(reportId, call.value) : back,
    RedirectType.replace
  );
}

/** What a move's form sent, as the use case's action; it checks the rest. */
function actionFrom(formData: FormData): ReportAction {
  const event = text(formData, "event");
  switch (event) {
    case "triage":
      return { event, severity: text(formData, "severity") } as ReportAction;
    case "escalate":
      return {
        event,
        authorityReference: text(formData, "authorityReference"),
      };
    case "resolve":
      return { event, outcome: text(formData, "outcome") };
    default:
      return { event } as ReportAction;
  }
}

/** Triage, investigate, escalate or resolve, from the report page. */
export async function moveReportAction(formData: FormData): Promise<void> {
  await leadStep(formData, async (reportId, useCases) =>
    outcomeOfMove(
      await useCases.moveSafeguardingReport({
        reportId,
        action: actionFrom(formData),
      })
    )
  );
}

/** Gives the report to a lead, or to nobody (the empty choice). */
export async function assignReportAction(formData: FormData): Promise<void> {
  const assignee = text(formData, "assigneeUserId");
  await leadStep(formData, async (reportId, useCases) =>
    outcomeOfAssign(
      await useCases.assignSafeguardingReport({
        reportId,
        assigneeUserId: assignee === "" ? null : assignee,
      })
    )
  );
}

/** Adds a note to the report's incident log. */
export async function addNoteAction(formData: FormData): Promise<void> {
  await leadStep(formData, async (reportId, useCases) =>
    outcomeOfNote(
      await useCases.addIncidentLogEntry({
        reportId,
        body: text(formData, "body"),
      })
    )
  );
}
