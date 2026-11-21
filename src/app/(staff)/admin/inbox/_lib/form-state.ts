// What a staff form on a contact message shows after it sends: the outcome
// in words, and after a refusal what was typed (a note's words), so nothing
// is lost. Pure, so the actions stay small; the words arrive translated.

import { APP_ROUTES } from "@/lib/app-routes";
import { secondFactorPath } from "@/lib/second-factor-routes";
import type { DomainErrorCode } from "@/server/errors";

export type InboxFormState = {
  status: "idle" | "saved" | "unchanged" | "refused";
  /** The outcome in words; null before the first send. */
  message: string | null;
  /** What was typed, given back after a refusal. */
  typed: string;
};

export const IDLE: InboxFormState = {
  status: "idle",
  message: null,
  typed: "",
};

type Outcome<E extends string> =
  | { ok: true; changed?: boolean }
  | { ok: false; error: E };

export function inboxFormState<E extends string>(
  result: Outcome<E>,
  texts: { saved: string; unchanged: string; refused: Record<E, string> },
  typed = ""
): InboxFormState {
  if (!result.ok) {
    return { status: "refused", message: texts.refused[result.error], typed };
  }
  return result.changed === false
    ? { status: "unchanged", message: texts.unchanged, typed: "" }
    : { status: "saved", message: texts.saved, typed: "" };
}

/**
 * Where staff short of this session's second step go to enter or renew it
 * (#60), with the inbox page to come back to: the message's, or the list.
 * Null for a refusal no second step can lift (forbidden).
 */
export function secondStepRedirect(
  refusal: DomainErrorCode,
  messageId?: string
): string | null {
  return secondFactorPath(
    refusal,
    messageId
      ? `${APP_ROUTES.adminInbox}/${encodeURIComponent(messageId)}`
      : APP_ROUTES.adminInbox
  );
}
