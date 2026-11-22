// What the students pages say after a coordinator adds or withdraws a
// student (#75), from the use cases' results. Pure, so the mapping is
// tested without a page; the actions translate the keys.

import type {
  EnrolStudentResult,
  StudentField,
  StudentFieldError,
  StudentInput,
  WithdrawStudentResult,
} from "@/server/modules/registration";

/** The form's fields, in the order the form shows them. */
export const STUDENT_FIELDS = [
  "fullName",
  "dateOfBirth",
  "grade",
  "studentRef",
  "guardianName",
  "guardianRelationship",
  "guardianPhone",
  "guardianEmail",
  "phone",
  "email",
  "address",
  "pinCode",
  "city",
  "state",
] as const satisfies readonly StudentField[];

/** What the alert above the form says, as `newStudent.alert.<key>`. */
export type EnrolAlert =
  | "check_details"
  | "already_enrolled"
  | "closed"
  | "not_open_yet"
  | "institution_not_verified"
  | "not_found"
  | "age_groups_need_fixing"
  | "failed";

export type EnrolFormState =
  | { enrolled: { registrationId: string; ignored: boolean } }
  | {
      values: StudentInput;
      alert: EnrolAlert;
      /** Each field at fault, as its message key under `newStudent.errors`. */
      fields: Partial<Record<StudentField, FieldMessageKey>>;
      /** For the date of birth's message when no age group takes the age. */
      outsideAge?: {
        age: number;
        minAge: number;
        maxAge: number;
        ageCutoffDate: string;
      };
    };

/** The fields a student can't go without, each with its own message. */
const REQUIRED_FIELDS = [
  "fullName",
  "dateOfBirth",
  "guardianName",
  "guardianRelationship",
  "guardianPhone",
  "phone",
] as const satisfies readonly StudentField[];

/** A field's message, as its key under `newStudent.errors`. */
export type FieldMessageKey =
  | `required.${(typeof REQUIRED_FIELDS)[number]}`
  | "missing"
  | Exclude<StudentFieldError, "required">
  | "outside_age_groups";

/** What the add-a-student form shows next, already translated. */
export type StudentFormView = {
  values: StudentInput;
  text: {
    alert?: string;
    fields: Partial<Record<StudentField, string>>;
  };
};

export const START_STUDENT_FORM: StudentFormView = {
  values: {},
  text: { fields: {} },
};

/**
 * A `YYYY-MM-DD` calendar date as midnight in India, so the app's date
 * formats (in IST) print that same day.
 */
export function calendarDateInstant(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+05:30`);
}

/** A missing field is named by the field; anything else by what's wrong. */
export function fieldMessageKey(
  field: StudentField,
  code: StudentFieldError
): FieldMessageKey {
  if (code !== "required") return code;
  const required = REQUIRED_FIELDS.find((each) => each === field);
  return required ? `required.${required}` : "missing";
}

/** The ages a competition takes, youngest group's minimum to oldest's maximum. */
export function ageRange(
  groups: readonly { minAge: number; maxAge: number }[]
): { minAge: number; maxAge: number } | null {
  if (groups.length === 0) return null;
  return {
    minAge: Math.min(...groups.map((group) => group.minAge)),
    maxAge: Math.max(...groups.map((group) => group.maxAge)),
  };
}

/** The result as the form shows it; `undefined` when the use case threw. */
export function enrolFormState(
  values: StudentInput,
  result: EnrolStudentResult | undefined
): EnrolFormState {
  if (result?.ok) {
    return {
      enrolled: {
        registrationId: result.registrationId,
        ignored: result.ignored.length > 0,
      },
    };
  }
  const refused = (alert: EnrolAlert) => ({ values, alert, fields: {} });
  if (!result) return refused("failed");
  // The page's own form sends the ids: bad input means the registration
  // it named isn't there.
  if (result.error === "invalid_input") return refused("not_found");
  if (result.error !== "invalid_student") return refused(result.error);

  const fields: Partial<Record<StudentField, FieldMessageKey>> = {};
  let outsideAge: Extract<EnrolFormState, { values: unknown }>["outsideAge"];
  for (const problem of result.problems) {
    if (!("field" in problem)) return refused("age_groups_need_fixing");
    if (problem.code === "outside_age_groups") {
      fields.dateOfBirth = problem.code;
      const range = ageRange(problem.groups);
      if (range) {
        outsideAge = {
          age: problem.age,
          ...range,
          ageCutoffDate: problem.ageCutoffDate,
        };
      }
    } else {
      fields[problem.field] = fieldMessageKey(problem.field, problem.code);
    }
  }
  return {
    values,
    alert: "check_details",
    fields,
    ...(outsideAge ? { outsideAge } : {}),
  };
}

/** What the list says after a withdraw button, as `students.outcome.<key>`. */
export const STUDENTS_OUTCOMES = [
  "enrolled",
  "enrolledIgnored",
  "withdrawn",
  "not_found",
  "not_enrolled",
  "closed",
  "not_open_yet",
  "institution_not_verified",
  "failed",
] as const;

export type StudentsOutcome = (typeof STUDENTS_OUTCOMES)[number];

export function isStudentsOutcome(value: unknown): value is StudentsOutcome {
  return STUDENTS_OUTCOMES.includes(value as StudentsOutcome);
}

/** A withdrawal's result as the list says it; `undefined` when it threw. */
export function withdrawOutcome(
  result: WithdrawStudentResult | undefined
): StudentsOutcome {
  if (!result) return "failed";
  if (result.ok) return "withdrawn";
  return result.error === "invalid_input" ? "not_found" : result.error;
}
