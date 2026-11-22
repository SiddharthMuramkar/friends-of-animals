import { describe, expect, it } from "vitest";

import type { AgeGroup } from "./age-group";
import {
  prepareStudent,
  type EnrolmentContext,
  type PrepareStudentTools,
} from "./prepare-student";
import type { StudentInput } from "./student-details";

const JUNIORS: AgeGroup = { id: "g-6", label: "6–9", minAge: 6, maxAge: 9 };
const SENIORS: AgeGroup = {
  id: "g-10",
  label: "10–13",
  minAge: 10,
  maxAge: 13,
};

const CONTEXT: EnrolmentContext = {
  ageCutoffDate: "2027-06-01",
  ageGroups: [SENIORS, JUNIORS],
  today: { year: 2027, month: 1, day: 15 },
  institutionDefaults: {
    pinCode: "411001",
    city: "Pune",
    state: "Maharashtra",
  },
};

const TOOLS: PrepareStudentTools = {
  // Stands in for #58's E.164 normaliser: ten digits from 6-9, +91 optional.
  normalisePhone: (raw) => {
    const digits = raw.replace(/[\s-]/g, "").replace(/^\+91/, "");
    return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
  },
  // Shows what is hashed under which purpose: #58's blind index is a keyed
  // HMAC of exactly these two.
  blindIndex: { of: (purpose, value) => `hmac(${purpose}, ${value})` },
};

const prepare = (input: StudentInput, context = CONTEXT) =>
  prepareStudent(context, input, TOOLS);

// 10 on the cut-off day (1 June 2027), 9 today (15 January 2027).
const CHILD: StudentInput = {
  fullName: "Aanya  Rao",
  dateOfBirth: "2017-06-01",
  grade: "Class 4",
  guardianName: "Kavita Rao",
  guardianRelationship: "parent",
  guardianPhone: "98765 43210",
};

const AANYA_HASH =
  "hmac(participant_profile.identity, student-identity:v1:aanya rao|2017-06-01)";

describe("prepareStudent", () => {
  it("readies a child: details, age group, the institution's location, identity hash", () => {
    expect(prepare(CHILD)).toEqual({
      ok: true,
      student: {
        details: {
          fullName: "Aanya Rao",
          dateOfBirth: { year: 2017, month: 6, day: 1 },
          isMinor: true,
          grade: "Class 4",
          studentRef: null,
          address: null,
          pinCode: "411001",
          city: "Pune",
          state: "Maharashtra",
          contact: {
            kind: "guardian",
            name: "Kavita Rao",
            relationship: "parent",
            phone: "+919876543210",
            email: null,
          },
        },
        ignored: [],
        ageGroup: SENIORS,
        identityHash: AANYA_HASH,
        studentRefKey: null,
      },
    });
  });

  it("recognises the same child spelled another way", () => {
    const again = prepare({
      ...CHILD,
      fullName: " aanyá rao",
      dateOfBirth: "01/06/2017",
    });
    expect(again.ok && again.student.identityHash).toBe(AANYA_HASH);
  });

  it("recognises a child by roll number too, whatever its case or spaces", () => {
    const withRef = prepare({ ...CHILD, studentRef: " 4b  07 " });
    const sameRef = prepare({
      ...CHILD,
      fullName: "A. Rao",
      studentRef: "4B 07",
    });
    expect(withRef.ok && withRef.student.studentRefKey).toBe("4B 07");
    expect(sameRef.ok && sameRef.student.studentRefKey).toBe("4B 07");
    expect(withRef.ok && withRef.student.details.studentRef).toBe("4b 07");
  });

  it("keeps a student's own location over the institution's", () => {
    const result = prepare({ ...CHILD, city: "Nashik", state: "Maharashtra" });
    expect(result.ok && result.student.details).toMatchObject({
      pinCode: null,
      city: "Nashik",
      state: "Maharashtra",
    });
  });

  it("refuses a student outside every age group, saying the ages and the cut-off", () => {
    expect(prepare({ ...CHILD, dateOfBirth: "2013-06-01" })).toEqual({
      ok: false,
      problems: [
        {
          field: "dateOfBirth",
          code: "outside_age_groups",
          age: 14,
          groups: [JUNIORS, SENIORS],
          ageCutoffDate: "2027-06-01",
        },
      ],
    });
  });

  it("names a competition whose age groups overlap as a set-up problem", () => {
    const overlapping = {
      ...JUNIORS,
      id: "g-9",
      label: "9–12",
      minAge: 9,
      maxAge: 12,
    };
    expect(
      prepare(CHILD, { ...CONTEXT, ageGroups: [SENIORS, overlapping] })
    ).toEqual({ ok: false, problems: [{ code: "overlapping_age_groups" }] });
  });

  it("reports every field problem, and no age group until the details are right", () => {
    expect(
      prepare({ ...CHILD, fullName: "A", guardianPhone: "12345" })
    ).toEqual({
      ok: false,
      problems: [
        { field: "fullName", code: "too_short" },
        { field: "guardianPhone", code: "invalid_phone" },
      ],
    });
  });
});
