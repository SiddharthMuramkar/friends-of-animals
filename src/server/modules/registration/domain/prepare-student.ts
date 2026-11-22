// One student made ready to enrol in a competition (#75), from the raw
// details a coordinator gives on the form or in a row of a CSV import
// (#76), so both are held to the same rules: the details are checked,
// the student is placed in one of the competition's age groups, a missing
// location is taken from the institution, and the student gets the keys
// that recognise the same child entered twice (./identity-key.ts).
//
// Pure: the caller loads the context, and passes #58's phone normaliser
// and blind index. Loads under plain Node.

import { ageGroupFor, type AgeGroup } from "./age-group";
import { type CalendarDate, parseIsoDate } from "./calendar-date";
import { identityKeyInput, studentRefKey } from "./identity-key";
import {
  parseStudentDetails,
  type StudentDetails,
  type StudentField,
  type StudentFieldError,
  type StudentInput,
} from "./student-details";

/** What enrolling a student needs to know, loaded for one registration. */
export type EnrolmentContext = {
  /** `YYYY-MM-DD`: ages are completed years on this date. */
  ageCutoffDate: string;
  ageGroups: readonly AgeGroup[];
  /** Today's date in India. */
  today: CalendarDate;
  /** Where the institution is: a student's location when none is given. */
  institutionDefaults: {
    pinCode: string | null;
    city: string | null;
    state: string | null;
  };
};

/** #58's blind index: a keyed hash of a normalised value, per purpose. */
export type BlindIndexer = { of(purpose: string, value: string): string };

export type PrepareStudentTools = {
  /** #58's normaliser: E.164, or null when it isn't a phone number. */
  normalisePhone: (raw: string) => string | null;
  blindIndex: BlindIndexer;
};

/** What the profile's identity hash is a blind index of. */
export const IDENTITY_HASH_PURPOSE = "participant_profile.identity";

export type StudentProblem =
  | { field: StudentField; code: StudentFieldError }
  | {
      field: "dateOfBirth";
      code: "outside_age_groups";
      age: number;
      /** Youngest first. */
      groups: AgeGroup[];
      /** `YYYY-MM-DD`: the day the age is counted on. */
      ageCutoffDate: string;
    }
  /** The competition's age groups need fixing by FOA staff. */
  | { code: "overlapping_age_groups" | "no_age_groups" };

export type PreparedStudent = {
  details: StudentDetails;
  /** Details given that this student's case doesn't use, so not kept. */
  ignored: StudentField[];
  ageGroup: AgeGroup;
  /** Stored with the profile: the blind index of the identity key. */
  identityHash: string;
  /** The roll number as matching compares it, if there is one. */
  studentRefKey: string | null;
};

export type PrepareStudentResult =
  | { ok: true; student: PreparedStudent }
  | { ok: false; problems: StudentProblem[] };

export function prepareStudent(
  context: EnrolmentContext,
  input: StudentInput,
  { normalisePhone, blindIndex }: PrepareStudentTools
): PrepareStudentResult {
  const parsed = parseStudentDetails(input, {
    today: context.today,
    normalisePhone,
  });
  if (!parsed.ok) {
    return {
      ok: false,
      problems: Object.entries(parsed.errors).map(([field, code]) => ({
        field: field as StudentField,
        code,
      })),
    };
  }
  const cutoff = parseIsoDate(context.ageCutoffDate);
  if (!cutoff) {
    throw new Error("EnrolmentContext: the age cut-off is not a date");
  }
  const placed = ageGroupFor(
    parsed.value.dateOfBirth,
    cutoff,
    context.ageGroups
  );
  if (!placed.ok) {
    return {
      ok: false,
      problems: [
        placed.reason === "outside_age_groups"
          ? {
              field: "dateOfBirth",
              code: placed.reason,
              age: placed.age,
              groups: placed.groups,
              ageCutoffDate: context.ageCutoffDate,
            }
          : { code: placed.reason },
      ],
    };
  }
  const details = { ...parsed.value, ...location(parsed.value, context) };
  const identityHash = blindIndex.of(
    IDENTITY_HASH_PURPOSE,
    identityKeyInput(details.fullName, details.dateOfBirth)
  );
  return {
    ok: true,
    student: {
      details,
      ignored: parsed.ignored,
      ageGroup: placed.group,
      identityHash,
      studentRefKey: studentRefKey(details.studentRef),
    },
  };
}

/** The student's own location, or the institution's when none is given. */
function location(
  details: StudentDetails,
  context: EnrolmentContext
): Pick<StudentDetails, "pinCode" | "city" | "state"> {
  return details.pinCode === null &&
    details.city === null &&
    details.state === null
    ? context.institutionDefaults
    : { pinCode: details.pinCode, city: details.city, state: details.state };
}
