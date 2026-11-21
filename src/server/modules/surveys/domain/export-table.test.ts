import { describe, expect, it } from "vitest";

import { buildExportTable, type ExportResponse } from "./export-table";
import type { SurveyQuestion } from "./questions";

const QUESTIONS: SurveyQuestion[] = [
  { id: "intro", kind: "prompt", text: "Hi", options: [], required: false },
  { id: "q1", kind: "rating_1_5", text: "Rate", options: [], required: true },
  {
    id: "q2",
    kind: "single_choice",
    text: "Again?",
    options: [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
    ],
    required: false,
  },
  {
    id: "q3",
    kind: "multiple_choice",
    text: "Liked",
    options: [
      { id: "a", label: "Art" },
      { id: "b", label: "Books" },
      { id: "c", label: "Cats" },
    ],
    required: false,
  },
  { id: "q4", kind: "free_text", text: "Say", options: [], required: false },
];

const LABELS = {
  submittedOn: "Submitted on",
  respondentName: "Name",
  respondentEmail: "Email",
  respondentRole: "Role",
  roles: {
    participant: "Participant",
    guardian: "Guardian",
    coordinator: "Coordinator",
  },
};

const ASHA = {
  name: "Asha Rao",
  email: "asha@example.test",
  role: "guardian" as const,
};
const RAVI = {
  name: "Ravi Kumar",
  email: "ravi@example.test",
  role: "participant" as const,
};

const RESPONSES: ExportResponse[] = [
  {
    id: "f1e2d3c4-0000-4000-8000-000000000002",
    submittedOn: "2027-03-02",
    respondent: ASHA,
    answers: [
      { questionId: "q1", value: 4 },
      { questionId: "q3", value: ["c", "a"] },
      { questionId: "q4", value: "My son Kabir loved it" },
    ],
  },
  {
    id: "0a1b2c3d-0000-4000-8000-000000000001",
    submittedOn: "2027-03-01",
    respondent: RAVI,
    answers: [
      { questionId: "q1", value: 5 },
      { questionId: "q2", value: "yes" },
    ],
  },
];

const anonymous = { identified: false, includeFreeTextInExport: false };

describe("buildExportTable", () => {
  it("exports an anonymous survey with no identity, ids or free text", () => {
    const table = buildExportTable(
      { ...anonymous, questions: QUESTIONS },
      RESPONSES,
      LABELS
    );

    expect(table).toEqual({
      header: ["Submitted on", "Rate", "Again?", "Liked"],
      // ordered by the random response id, not by when people answered
      rows: [
        ["2027-03-01", 5, "Yes", null],
        ["2027-03-02", 4, null, "Art; Cats"],
      ],
    });
    const cells = JSON.stringify(table);
    for (const personal of [
      ASHA.name,
      ASHA.email,
      RAVI.email,
      "Kabir",
      RESPONSES[0]!.id,
      "Guardian",
    ]) {
      expect(cells).not.toContain(personal);
    }
  });

  it("adds free-text columns only when the survey says so", () => {
    const table = buildExportTable(
      { ...anonymous, includeFreeTextInExport: true, questions: QUESTIONS },
      RESPONSES,
      LABELS
    );
    expect(table.header).toEqual([
      "Submitted on",
      "Rate",
      "Again?",
      "Liked",
      "Say",
    ]);
    expect(table.rows.map((row) => row.at(-1))).toEqual([
      null,
      "My son Kabir loved it",
    ]);
  });

  it("adds the respondent's name, email and role on an identified survey", () => {
    const table = buildExportTable(
      {
        identified: true,
        includeFreeTextInExport: false,
        questions: QUESTIONS,
      },
      RESPONSES,
      LABELS
    );
    expect(table).toEqual({
      header: [
        "Submitted on",
        "Name",
        "Email",
        "Role",
        "Rate",
        "Again?",
        "Liked",
      ],
      rows: [
        [
          "2027-03-01",
          "Ravi Kumar",
          "ravi@example.test",
          "Participant",
          5,
          "Yes",
          null,
        ],
        [
          "2027-03-02",
          "Asha Rao",
          "asha@example.test",
          "Guardian",
          4,
          null,
          "Art; Cats",
        ],
      ],
    });
  });

  it("leaves identity cells empty for a response stored without one", () => {
    const table = buildExportTable(
      {
        identified: true,
        includeFreeTextInExport: false,
        questions: QUESTIONS,
      },
      [{ ...RESPONSES[1]!, respondent: null }],
      LABELS
    );
    expect(table.rows).toEqual([
      ["2027-03-01", null, null, null, 5, "Yes", null],
    ]);
  });
});
