import { describe, expect, it } from "vitest";

import {
  afterFailure,
  afterSubmit,
  concernInput,
  EMPTY,
  enteredFrom,
  type ConcernFormEntered,
} from "./form-state";

const entered: ConcernFormEntered = {
  category: "bullying",
  description: "They laugh at me in the group chat",
  subjectDetails: "Me, Class 6",
  subjectAge: "11",
  reporterIsChild: true,
  anonymous: false,
  reporterName: "Asha",
  reporterContact: "asha@example.test",
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("enteredFrom", () => {
  it("reads the fields as typed, and ticked boxes as true", () => {
    expect(
      enteredFrom(
        form({
          category: "bullying",
          description: "They laugh at me in the group chat",
          subjectDetails: "Me, Class 6",
          subjectAge: "11",
          reporterIsChild: "on",
          reporterName: "Asha",
          reporterContact: "asha@example.test",
        })
      )
    ).toEqual(entered);
  });

  it("reads missing fields as blank and unticked boxes as false", () => {
    expect(enteredFrom(new FormData())).toEqual(EMPTY);
  });
});

describe("concernInput", () => {
  it("sends what was typed, the age as a number", () => {
    expect(concernInput(entered)).toEqual({
      category: "bullying",
      description: "They laugh at me in the group chat",
      subjectDetails: "Me, Class 6",
      subjectAge: 11,
      reporterIsChild: true,
      anonymous: false,
      reporterName: "Asha",
      reporterContact: "asha@example.test",
    });
  });

  it("sends no age for “I don’t know”, and a bad one for the use case to refuse", () => {
    expect(concernInput({ ...entered, subjectAge: "" }).subjectAge).toBeNull();
    expect(concernInput({ ...entered, subjectAge: "x" }).subjectAge).toBeNaN();
  });

  it("sends no name or contact when the reporter stays anonymous", () => {
    expect(concernInput({ ...entered, anonymous: true })).toMatchObject({
      anonymous: true,
      reporterName: null,
      reporterContact: null,
    });
  });
});

describe("afterSubmit", () => {
  it("moves on once the report is sent, keeping nothing typed", () => {
    expect(afterSubmit({ ok: true }, entered)).toEqual({
      step: "sent",
      entered: EMPTY,
    });
  });

  it("keeps what was typed and marks the fields to fix", () => {
    expect(
      afterSubmit(
        {
          ok: false,
          error: "invalid_input",
          fields: ["description", "subjectAge", "anonymous"],
        },
        entered
      )
    ).toEqual({
      step: "form",
      entered,
      fieldErrors: { description: true, subjectAge: true },
    });
  });

  it("asks to send again when the human check failed", () => {
    expect(
      afterSubmit({ ok: false, error: "human_check_failed" }, entered)
    ).toEqual({ step: "form", entered, alert: "human_check_failed" });
  });

  it("says how many minutes to wait when rate limited, rounded up", () => {
    expect(
      afterSubmit(
        {
          ok: false,
          error: "rate_limited",
          retryAfter: new Date("2026-03-02T05:00:00Z"),
          retryAfterSeconds: 61,
        },
        entered
      )
    ).toEqual({
      step: "form",
      entered,
      alert: "rate_limited",
      retryAfterMinutes: 2,
    });
  });
});

describe("afterFailure", () => {
  it("keeps what was typed and says the report wasn't sent", () => {
    expect(afterFailure(entered)).toEqual({
      step: "form",
      entered,
      alert: "failed",
    });
  });
});
