// What the volunteer application form shows after it sends (#123): the
// problem in words the page looks up, the fields at fault, and everything
// that was ticked or typed, so nothing is lost. Pure, so the action stays
// small.

import type { ApplyToVolunteerResult } from "@/server/modules/volunteers";

export type ApplyValues = {
  interests: string[];
  /** `day:part`, as the availability boxes send them. */
  slots: string[];
  note: string;
  dateOfBirth: string;
  safeguardingDocumentId: string;
  conductDocumentId: string;
};

export type ApplyProblem =
  | Exclude<
      Extract<ApplyToVolunteerResult, { ok: false }>["error"],
      "invalid_input"
    >
  | "invalid_input"
  | "declarations_required"
  | "unexpected";

/** The fields a problem can point at, as the form names them. */
export type ApplyField =
  | "interests"
  | "availability"
  | "dateOfBirth"
  | "declarations";

export type ApplyState = {
  problem: ApplyProblem | null;
  fields: ApplyField[];
  values: ApplyValues;
};

export const EMPTY_VALUES: ApplyValues = {
  interests: [],
  slots: [],
  note: "",
  dateOfBirth: "",
  safeguardingDocumentId: "",
  conductDocumentId: "",
};

export const IDLE: ApplyState = {
  problem: null,
  fields: [],
  values: EMPTY_VALUES,
};

function strings(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string");
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The form's fields as sent. Each declaration box sends its document's id. */
export function readApplyForm(formData: FormData): ApplyValues {
  return {
    interests: strings(formData, "interests"),
    slots: strings(formData, "slots"),
    note: text(formData, "note"),
    dateOfBirth: text(formData, "dateOfBirth"),
    safeguardingDocumentId: text(formData, "safeguardingDocumentId"),
    conductDocumentId: text(formData, "conductDocumentId"),
  };
}

/** The use case's input from what was sent. */
export function applyInputOf(values: ApplyValues) {
  return {
    interests: values.interests,
    availability: {
      slots: values.slots.map((slot) => {
        const [day = "", part = ""] = slot.split(":");
        return { day, part };
      }),
      note: values.note,
    },
    ...(values.dateOfBirth === "" ? {} : { dateOfBirth: values.dateOfBirth }),
    safeguardingDocumentId: values.safeguardingDocumentId,
    conductDocumentId: values.conductDocumentId,
  };
}

/** Both boxes ticked: each sends its document's id. */
export function declarationsTicked(values: ApplyValues): boolean {
  return (
    values.safeguardingDocumentId !== "" && values.conductDocumentId !== ""
  );
}

const FIELD_OF: Partial<Record<ApplyProblem, ApplyField>> = {
  declarations_required: "declarations",
  declaration_outdated: "declarations",
  declaration_unpublished: "declarations",
  date_of_birth_required: "dateOfBirth",
  under_min_age: "dateOfBirth",
};

/** The state after a refusal, keeping what was sent. */
export function refused(
  values: ApplyValues,
  problem: ApplyProblem,
  fields: readonly string[] = []
): ApplyState {
  const named = fields.filter((field): field is ApplyField =>
    ["interests", "availability", "dateOfBirth", "declarations"].includes(field)
  );
  const own = FIELD_OF[problem];
  return {
    problem,
    fields: own && !named.includes(own) ? [...named, own] : named,
    values,
  };
}
