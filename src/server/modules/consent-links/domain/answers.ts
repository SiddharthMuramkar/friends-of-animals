// The guardian's answers on a consent link: give or decline each public
// use the competition offers, every one of them, nothing else. Checked
// before anything is written, so a half-answered form records nothing.
//
// Loads under plain Node (the seed script): relative imports only.

export const ANSWERS = ["give", "decline"] as const;
export type Answer = (typeof ANSWERS)[number];

/** A public use the competition asks about, and the document shown for it. */
export type OfferedUse = { purpose: string; documentId: string };

/** One checked answer, tied to the exact document the guardian was shown. */
export type CheckedAnswer<Use extends OfferedUse = OfferedUse> = Use & {
  answer: Answer;
};

export type AnswersCheck<Use extends OfferedUse = OfferedUse> =
  | { ok: true; answers: CheckedAnswer<Use>[] }
  | { ok: false; reason: "nothing_offered" }
  | {
      ok: false;
      reason: "unanswered" | "not_offered" | "invalid_answer";
      purposes: string[];
    };

const isAnswer = (value: unknown): value is Answer =>
  value === "give" || value === "decline";

/**
 * Checks `submitted` (purpose → answer, as the form posts it) against the
 * offered uses. Answers come back in the offered order.
 */
export function checkAnswers<Use extends OfferedUse>(
  offered: readonly Use[],
  submitted: Readonly<Record<string, unknown>>
): AnswersCheck<Use> {
  if (offered.length === 0) return { ok: false, reason: "nothing_offered" };
  const offeredPurposes = new Set(offered.map((use) => use.purpose));

  const notOffered = Object.keys(submitted).filter(
    (purpose) => !offeredPurposes.has(purpose)
  );
  if (notOffered.length > 0) {
    return { ok: false, reason: "not_offered", purposes: notOffered };
  }

  const invalid = offered
    .filter(
      (use) =>
        Object.hasOwn(submitted, use.purpose) &&
        !isAnswer(submitted[use.purpose])
    )
    .map((use) => use.purpose);
  if (invalid.length > 0) {
    return { ok: false, reason: "invalid_answer", purposes: invalid };
  }

  const unanswered = offered
    .filter((use) => !Object.hasOwn(submitted, use.purpose))
    .map((use) => use.purpose);
  if (unanswered.length > 0) {
    return { ok: false, reason: "unanswered", purposes: unanswered };
  }

  return {
    ok: true,
    answers: offered.map((use) => ({
      ...use,
      answer: submitted[use.purpose] as Answer,
    })),
  };
}
