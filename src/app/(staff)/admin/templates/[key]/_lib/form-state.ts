// What the template editor shows after a save: the outcome, a message per
// field at fault, and the submitted values so nothing typed is lost. Pure,
// so the action stays small; messages arrive already translated.

import type {
  RevisionProblem,
  UpdateMessageTemplateResult,
} from "@/server/modules/notifications";

export type TemplateField = "subject" | "body" | "dltTemplateId";

export type TemplateFormValues = {
  subject: string;
  body: string;
  dltTemplateId: string;
};

export type TemplateFormState = {
  status: "idle" | "saved" | "unchanged" | "stale" | "invalid" | "refused";
  /** The version the next save starts from. */
  version: number;
  fieldErrors: Partial<Record<TemplateField, string>>;
  /** What was submitted, shown again after a refusal. */
  values: TemplateFormValues | null;
  /** Why a `refused` save was refused, already translated. */
  message?: string;
};

export type FormTexts = {
  /** The message for one problem reviseTemplate found. */
  problem: (problem: RevisionProblem) => string;
  /** For a field past the form's hard limit. */
  tooLong: string;
};

export function templateFormState(
  before: { version: number },
  submitted: TemplateFormValues,
  result: UpdateMessageTemplateResult,
  texts: FormTexts
): TemplateFormState {
  const base = { version: before.version, fieldErrors: {}, values: null };
  if (result.ok) {
    const changed = result.template.version !== before.version;
    return {
      ...base,
      status: changed ? "saved" : "unchanged",
      version: result.template.version,
    };
  }
  if (result.error === "invalid_template") {
    const fieldErrors: TemplateFormState["fieldErrors"] = {};
    for (const problem of result.problems) {
      fieldErrors[problem.field] ??= texts.problem(problem);
    }
    return { ...base, status: "invalid", fieldErrors, values: submitted };
  }
  if (result.error === "invalid_input") {
    const fieldErrors: TemplateFormState["fieldErrors"] = {};
    for (const field of result.fields) {
      if (
        field === "subject" ||
        field === "body" ||
        field === "dltTemplateId"
      ) {
        fieldErrors[field] = texts.tooLong;
      }
    }
    return { ...base, status: "invalid", fieldErrors, values: submitted };
  }
  // stale, or the template is gone: reload to see what is there now.
  return { ...base, status: "stale", values: submitted };
}

/**
 * A save the use case refused: the actor isn't a content manager, or is
 * staff who hasn't passed this session's second factor (#60). Says why
 * and keeps what was typed.
 */
export function refusedFormState(
  before: { version: number },
  submitted: TemplateFormValues,
  message: string
): TemplateFormState {
  return {
    status: "refused",
    version: before.version,
    fieldErrors: {},
    values: submitted,
    message,
  };
}
