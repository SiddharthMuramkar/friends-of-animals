// What a staff form on a contact message shows after it sends: the outcome
// in words, and after a refusal what was typed (a note's words), so nothing
// is lost. Pure, so the actions stay small; the words arrive translated.

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
