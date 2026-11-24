// What a decision form on a volunteer application shows after a refusal
// (#123): why, in words, and the decline reason that was typed, so nothing
// is lost. A decision itself goes back to the application page. Pure; the
// words arrive translated.

export type DecisionState = {
  status: "idle" | "refused";
  /** Why it was refused, in words; null before the first send. */
  message: string | null;
  /** The decline reason typed, given back after a refusal. */
  typed: string;
};

export const IDLE: DecisionState = { status: "idle", message: null, typed: "" };

export function refusedState<E extends string>(
  error: E,
  words: Record<E, string>,
  typed = ""
): DecisionState {
  return { status: "refused", message: words[error], typed };
}
