"use server";

import { getTranslations } from "next-intl/server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { errorSummaryForLogs } from "@/server/errors";

import {
  inboxFormState,
  secondStepRedirect,
  type InboxFormState,
} from "./form-state";
import { unlessRefused, type Loaded } from "./refusal";

// The staff forms on a contact message. Each calls one use case, which
// authorizes (the message's team, staff admins and super admins, with
// this session's second step, #60) and checks the input; the action maps
// its answer to words and refreshes the page after a change, so the
// status, assignee and notes follow. A refusal for want of a second step
// sends the user to enter it, then back to the message. A use case that
// fails outright (the database, say) is said in the form too, which gives
// a note's words back.

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
 * Runs the use case; a refusal goes to #60's screens when a second step
 * lifts it, and otherwise comes back as the form's refusal, as does a
 * failure.
 */
async function handle<T>(
  messageId: string,
  run: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; state: InboxFormState }> {
  let outcome: Loaded<T>;
  try {
    outcome = await unlessRefused(run);
  } catch (error) {
    // Only the error's class and Postgres code: its message can hold what
    // staff typed.
    console.error(
      `Contact inbox: the use case failed: ${errorSummaryForLogs(error)}`
    );
    const t = await getTranslations("adminInbox.detail");
    return {
      ok: false,
      state: { status: "refused", message: t("failed"), typed: "" },
    };
  }
  if (outcome.ok) return outcome;
  const lift = secondStepRedirect(outcome.refusal, messageId);
  if (lift) redirect(lift);
  const t = await getTranslations("adminInbox.detail");
  return {
    ok: false,
    state: { status: "refused", message: t("forbidden"), typed: "" },
  };
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
  const messageId = field(formData, "messageId");
  const status = field(formData, "status");
  const closeReason = field(formData, "closeReason");
  const outcome = await handle(messageId, () =>
    as(actor).changeContactMessageStatus({
      messageId,
      status,
      ...(status === "closed" && closeReason !== "" ? { closeReason } : {}),
    })
  );
  if (!outcome.ok) return outcome.state;
  const result = outcome.value;
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
  const messageId = field(formData, "messageId");
  const assigneeId = field(formData, "assigneeId");
  const outcome = await handle(messageId, () =>
    as(actor).assignContactMessage({
      messageId,
      assigneeId: assigneeId === "" ? null : assigneeId,
    })
  );
  if (!outcome.ok) return outcome.state;
  const result = outcome.value;
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
  const messageId = field(formData, "messageId");
  const body = field(formData, "body");
  const outcome = await handle(messageId, () =>
    as(actor).addContactNote({ messageId, body })
  );
  if (!outcome.ok) return { ...outcome.state, typed: body };
  const result = outcome.value;
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
