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
  institutionRegistration: {
    id: "ir-1",
    institutionId: "inst-1",
    competitionId: "comp-1",
    reference: "PAWS27-I-Q2W9R",
  },
  competition: {
    id: "comp-1",
    code: "PAWS27",
    name: "Paws for Thought 2027",
    ageCutoffDate: "2027-06-01",
  },
  ageGroups: [SENIORS, JUNIORS],
  today: { year: 2027, month: 1, day: 15 },
  institutionDefaults: { pinCode: "411001", city: "Pune", state: "Maharashtra" },
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
        matchKeys: [`id:${AANYA_HASH}`],
      },
    });
  });

  it("recognises the same child spelled another way", () => {
    const again = prepare({
      ...CHILD,
      fullName: " aanyá rao",
      dateOfBirth: "01/06/2017",
    });
    expect(again.ok && again.student.matchKeys).toEqual([`id:${AANYA_HASH}`]);
  });

  it("recognises a child by roll number too, whatever its case or spaces", () => {
    const withRef = prepare({ ...CHILD, studentRef: " 4b-07 " });
    const sameRef = prepare({ ...CHILD, fullName: "A. Rao", studentRef: "4B-07" });
    expect(withRef.ok && withRef.student.matchKeys).toEqual([
      `id:${AANYA_HASH}`,
      "ref:4B-07",
    ]);
    expect(sameRef.ok && sameRef.student.matchKeys).toContain("ref:4B-07");
    expect(withRef.ok && withRef.student.details.studentRef).toBe("4b-07");
  });
});
