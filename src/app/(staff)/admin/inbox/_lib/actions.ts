"use server";

import { getTranslations } from "next-intl/server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { inboxFormState, type InboxFormState } from "./form-state";

// The staff forms on a contact message. Each calls one use case, which
// authorizes (the message's team, staff admins and super admins) and
// checks the input; the action maps its answer to words and refreshes the
// page after a change, so the status, assignee and notes follow.

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function signedIn() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  return actor;
}

/**
 * Moves the message to the status of the button pressed (`status`). Only
 * closing sends the chosen reason, so a reason picked before pressing
 * another button doesn't refuse it.
 */
export async function changeStatusAction(
  _previous: InboxFormState,
  formData: FormData
): Promise<InboxFormState> {
  const actor = await signedIn();
  const status = field(formData, "status");
  const closeReason = field(formData, "closeReason");
  const result = await as(actor).changeContactMessageStatus({
    messageId: field(formData, "messageId"),
    status,
    ...(status === "closed" && closeReason !== "" ? { closeReason } : {}),
  });
  const t = await getTranslations("adminInbox.detail.statusForm");
  const next = inboxFormState(result, {
    saved: t("saved"),
    unchanged: t("unchanged"),
    refused: {
      not_found: t("refused.not_found"),
      invalid_input: t("refused.invalid_input"),
      transition_not_allowed: t("refused.transition_not_allowed"),
      close_reason_required: t("refused.close_reason_required"),
      close_reason_not_allowed: t("refused.close_reason_not_allowed"),
    },
  });
  if (next.status === "saved") refresh();
  return next;
}

/** Assigns the message to `assigneeId`, or to nobody when it is empty. */
export async function assignAction(
  _previous: InboxFormState,
  formData: FormData
): Promise<InboxFormState> {
  const actor = await signedIn();
  const assigneeId = field(formData, "assigneeId");
  const result = await as(actor).assignContactMessage({
    messageId: field(formData, "messageId"),
    assigneeId: assigneeId === "" ? null : assigneeId,
  });
  const t = await getTranslations("adminInbox.detail.assignForm");
  const next = inboxFormState(result, {
    saved: t("saved"),
    unchanged: t("unchanged"),
    refused: {
      not_found: t("refused.not_found"),
      invalid_input: t("refused.invalid_input"),
      message_closed: t("refused.message_closed"),
      assignee_not_allowed: t("refused.assignee_not_allowed"),
    },
  });
  if (next.status === "saved") refresh();
  return next;
}

/** Adds a note; after a refusal the form gets the words back. */
export async function addNoteAction(
  _previous: InboxFormState,
  formData: FormData
): Promise<InboxFormState> {
  const actor = await signedIn();
  const body = field(formData, "body");
  const result = await as(actor).addContactNote({
    messageId: field(formData, "messageId"),
    body,
  });
  const t = await getTranslations("adminInbox.detail.notes");
  const next = inboxFormState(
    result,
    {
      saved: t("saved"),
      unchanged: t("unchanged"),
      refused: {
        not_found: t("refused.not_found"),
        invalid_input: t("refused.invalid_input"),
      },
    },
    body
  );
  if (next.status === "saved") refresh();
  return next;
}
