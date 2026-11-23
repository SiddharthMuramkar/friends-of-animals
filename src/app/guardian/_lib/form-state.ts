// What the guardian pages' forms show between submissions (#81): what was
// typed, which fields to fix, and why a use case refused. Pure, so each
// mapping from a use-case result to what a form shows is tested on its own.

import type { InviteTeenLoginResult } from "@/server/modules/guardians";

type Refused<R> = Extract<R, { ok: false }>;

/** A use case's refusal as the forms read it: a reason, maybe fields. */
type Refusal = { ok: false; error: string; fields?: readonly string[] };

/* The declaration on /guardian/register. */

export const DECLARE_FIELDS = ["fullName", "phone", "adultDeclared"] as const;

export type DeclareField = (typeof DECLARE_FIELDS)[number];

export type DeclareValues = {
  fullName: string;
  phone: string;
  adultDeclared: boolean;
};

/** Refusals no field can fix, shown above the form. */
const DECLARE_PROBLEMS = [
  "linked_child",
  "registered_as_minor",
  "no_verified_email",
  "rate_limited",
  "unexpected",
] as const;

export type DeclareProblem = (typeof DECLARE_PROBLEMS)[number];

export type DeclareState = {
  /** Bumped on every submission, so the inputs remount with `values`. */
  attempt: number;
  values: DeclareValues;
  errors: DeclareField[];
  problem: DeclareProblem | null;
};

export const DECLARE_START: DeclareState = {
  attempt: 0,
  values: { fullName: "", phone: "", adultDeclared: false },
  errors: [],
  problem: null,
};

/**
 * The declaration form after a refusal, either from registerAsGuardian or
 * from the code that should have followed it. A reason it doesn't know
 * reads as unexpected.
 */
export function afterDeclare(
  previous: DeclareState,
  values: DeclareValues,
  result: Refusal | "unexpected"
): DeclareState {
  const next = { attempt: previous.attempt + 1, values, errors: [] };
  if (result === "unexpected") return { ...next, problem: "unexpected" };
  if (result.error === "invalid_input") {
    const fields = result.fields ?? [];
    return {
      ...next,
      errors: DECLARE_FIELDS.filter((field) => fields.includes(field)),
      problem: null,
    };
  }
  if (result.error === "adult_declaration_required") {
    return { ...next, errors: ["adultDeclared"], problem: null };
  }
  const problem = DECLARE_PROBLEMS.find((known) => known === result.error);
  return { ...next, problem: problem ?? "unexpected" };
}

/* Adding a child on /guardian/children/new. */

export const ADD_CHILD_FIELDS = [
  "fullName",
  "dateOfBirth",
  "relationship",
] as const;

export type AddChildField = (typeof ADD_CHILD_FIELDS)[number];

export type AddChildValues = Record<AddChildField, string>;

export type AddChildRefusal =
  | "dob_invalid"
  | "adult"
  | "already_added"
  | "unexpected";

export type AddChildState = {
  attempt: number;
  values: AddChildValues;
  errors: AddChildField[];
  refusal: AddChildRefusal | null;
};

export const ADD_CHILD_START: AddChildState = {
  attempt: 0,
  values: { fullName: "", dateOfBirth: "", relationship: "" },
  errors: [],
  refusal: null,
};

/** The add-child form after a refusal; an unknown reason is unexpected. */
export function afterAddChild(
  previous: AddChildState,
  values: AddChildValues,
  result: Refusal | "unexpected"
): AddChildState {
  const next = { attempt: previous.attempt + 1, values };
  if (result === "unexpected") {
    return { ...next, errors: [], refusal: "unexpected" };
  }
  switch (result.error) {
    case "invalid_input": {
      const fields = result.fields ?? [];
      return {
        ...next,
        errors: ADD_CHILD_FIELDS.filter((field) => fields.includes(field)),
        refusal: null,
      };
    }
    case "dob_invalid":
    case "adult":
      return { ...next, errors: ["dateOfBirth"], refusal: result.error };
    case "already_added":
      return { ...next, errors: [], refusal: "already_added" };
    default:
      return { ...next, errors: [], refusal: "unexpected" };
  }
}

/* Inviting a teen to an own login on /guardian/children/[id]. */

export type InviteProblem =
  | Refused<InviteTeenLoginResult>["error"]
  | "unexpected";

export type InviteState = { email: string; problem: InviteProblem | null };

export const INVITE_START: InviteState = { email: "", problem: null };

export function afterInvite(
  email: string,
  result: Refused<InviteTeenLoginResult> | "unexpected"
): InviteState {
  return { email, problem: result === "unexpected" ? result : result.error };
}

/* What the pages read back from the address bar. */

const CODE_ERRORS = [
  "code_invalid",
  "code_expired",
  "too_many_attempts",
  "rate_limited",
  "no_verified_email",
  "not_registered",
  "unexpected",
] as const;

export type CodeError = (typeof CODE_ERRORS)[number];

export function isCodeError(value: unknown): value is CodeError {
  return CODE_ERRORS.includes(value as CodeError);
}

const CHILD_OUTCOMES = [
  "added",
  "invited",
  "withdrawn",
  "no_pending_invitation",
] as const;

export type ChildOutcome = (typeof CHILD_OUTCOMES)[number];

export function isChildOutcome(value: unknown): value is ChildOutcome {
  return CHILD_OUTCOMES.includes(value as ChildOutcome);
}
