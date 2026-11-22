// What the "report a concern" form shows after each try, from the use
// case's result (#116). Pure, so the mapping is tested without a page.
// A sent report leaves the form for /safeguarding/report/sent, which shows
// nothing of it.

import type {
  SubmitSafeguardingReportInput,
  SubmitSafeguardingReportResult,
} from "@/server/modules/safeguarding";

/** The fields that can be marked wrong; the two boxes always parse. */
export type ConcernFormField =
  | "category"
  | "description"
  | "subjectDetails"
  | "subjectAge"
  | "reporterName"
  | "reporterContact";

const FIELDS: readonly ConcernFormField[] = [
  "category",
  "description",
  "subjectDetails",
  "subjectAge",
  "reporterName",
  "reporterContact",
];

export type ConcernFormEntered = Record<ConcernFormField, string> & {
  reporterIsChild: boolean;
  anonymous: boolean;
};

export type ConcernFormAlert = "human_check_failed" | "rate_limited" | "failed";

export type ConcernFormState = {
  step: "form" | "sent";
  /** What the form shows in its fields. */
  entered: ConcernFormEntered;
  /** A problem for the whole form. */
  alert?: ConcernFormAlert;
  retryAfterMinutes?: number;
  /** Fields to mark invalid; each has its own message. */
  fieldErrors?: Partial<Record<ConcernFormField, true>>;
};

export const EMPTY: ConcernFormEntered = {
  category: "",
  description: "",
  subjectDetails: "",
  subjectAge: "",
  reporterIsChild: false,
  anonymous: false,
  reporterName: "",
  reporterContact: "",
};

/** A fresh form starts anonymous: giving a name is a choice. */
export const START: ConcernFormState = {
  step: "form",
  entered: { ...EMPTY, anonymous: true },
};

/** The fields as typed; a missing field reads as blank, a box as unticked. */
export function enteredFrom(formData: FormData): ConcernFormEntered {
  const entered = { ...EMPTY };
  for (const field of FIELDS) {
    const value = formData.get(field);
    if (typeof value === "string") entered[field] = value;
  }
  entered.reporterIsChild = formData.get("reporterIsChild") === "on";
  entered.anonymous = formData.get("anonymous") === "on";
  return entered;
}

/** What the use case gets: the age as a number, no name when anonymous. */
export function concernInput(
  entered: ConcernFormEntered
): Omit<SubmitSafeguardingReportInput, "website" | "humanCheck"> {
  const { anonymous } = entered;
  return {
    category: entered.category,
    description: entered.description,
    subjectDetails: entered.subjectDetails,
    subjectAge: entered.subjectAge === "" ? null : Number(entered.subjectAge),
    reporterIsChild: entered.reporterIsChild,
    anonymous,
    reporterName: anonymous ? null : entered.reporterName,
    reporterContact: anonymous ? null : entered.reporterContact,
  };
}

export function afterSubmit(
  result: SubmitSafeguardingReportResult,
  entered: ConcernFormEntered
): ConcernFormState {
  if (result.ok) return { step: "sent", entered: EMPTY };
  switch (result.error) {
    case "invalid_input":
      return {
        step: "form",
        entered,
        fieldErrors: Object.fromEntries(
          FIELDS.filter((field) =>
            (result.fields as readonly string[]).includes(field)
          ).map((field) => [field, true])
        ),
      };
    case "rate_limited":
      return {
        step: "form",
        entered,
        alert: "rate_limited",
        retryAfterMinutes: Math.ceil(result.retryAfterSeconds / 60),
      };
    case "human_check_failed":
      return { step: "form", entered, alert: "human_check_failed" };
  }
}

/** When the use case fails outright: keep what was typed, and say so. */
export function afterFailure(entered: ConcernFormEntered): ConcernFormState {
  return { step: "form", entered, alert: "failed" };
}

/** The state plus its words, translated by the action on the server. */
export type ConcernFormView = ConcernFormState & {
  text: {
    alert?: string;
    errors: Partial<Record<ConcernFormField, string>>;
  };
};

export const START_VIEW: ConcernFormView = { ...START, text: { errors: {} } };
