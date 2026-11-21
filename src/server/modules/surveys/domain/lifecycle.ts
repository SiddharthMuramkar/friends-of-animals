// A survey's life: a draft the manager edits, open once it is sent (only
// after the competition's results are published), closed by hand or when
// its closing time passes. Closed is final. These rules decide each move;
// the use cases apply them.
//
// Pure: loads under plain Node (schema, seed), relative imports only.

export const SURVEY_STATUSES = ["draft", "open", "closed"] as const;
export type SurveyStatus = (typeof SURVEY_STATUSES)[number];

/** Defaults until FOA says otherwise (HR-66). */
export const SURVEY_WINDOW = { defaultDays: 14, maxDays: 90 } as const;

const DAY_MS = 86_400_000;

type Refusal<Reason extends string> = { ok: false; reason: Reason };

export function decideEdit(
  status: SurveyStatus
): { ok: true } | Refusal<"not_draft"> {
  return status === "draft" ? { ok: true } : { ok: false, reason: "not_draft" };
}

export function decideOpen(input: {
  status: SurveyStatus;
  resultsPublished: boolean;
  answerableQuestions: number;
  /** Null means the default window from now. */
  closesAt: Date | null;
  now: Date;
}):
  | { ok: true; closesAt: Date }
  | Refusal<
      | "not_draft"
      | "results_not_published"
      | "no_questions"
      | "invalid_closes_at"
    > {
  if (input.status !== "draft") return { ok: false, reason: "not_draft" };
  if (!input.resultsPublished) {
    return { ok: false, reason: "results_not_published" };
  }
  if (input.answerableQuestions === 0) {
    return { ok: false, reason: "no_questions" };
  }
  const now = input.now.getTime();
  const closesAt =
    input.closesAt ?? new Date(now + SURVEY_WINDOW.defaultDays * DAY_MS);
  const closes = closesAt.getTime();
  if (closes <= now || closes > now + SURVEY_WINDOW.maxDays * DAY_MS) {
    return { ok: false, reason: "invalid_closes_at" };
  }
  return { ok: true, closesAt };
}

export function decideClose(
  status: SurveyStatus
): { ok: true; changed: boolean } | Refusal<"not_open"> {
  if (status === "draft") return { ok: false, reason: "not_open" };
  return { ok: true, changed: status === "open" };
}

/** The status as respondents see it: open surveys close at `closesAt`. */
export function effectiveStatus(
  survey: { status: SurveyStatus; closesAt: Date | null },
  now: Date
): SurveyStatus {
  if (
    survey.status === "open" &&
    survey.closesAt !== null &&
    now.getTime() >= survey.closesAt.getTime()
  ) {
    return "closed";
  }
  return survey.status;
}

/** Whether an invited person may submit now. */
export function decideAnswer(input: {
  status: SurveyStatus;
  closesAt: Date | null;
  now: Date;
  /** When this person's invitation was answered, if it was. */
  respondedAt: Date | null;
}):
  | { ok: true }
  | Refusal<"not_found" | "survey_closed" | "already_responded"> {
  const status = effectiveStatus(input, input.now);
  if (status === "draft") return { ok: false, reason: "not_found" };
  if (status === "closed") return { ok: false, reason: "survey_closed" };
  if (input.respondedAt !== null) {
    return { ok: false, reason: "already_responded" };
  }
  return { ok: true };
}
