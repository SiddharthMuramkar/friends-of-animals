import { describe, expect, it } from "vitest";

import {
  decideAnswer,
  decideClose,
  decideEdit,
  decideOpen,
  effectiveStatus,
} from "./lifecycle";

const NOW = new Date("2027-03-01T04:30:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const ready = {
  status: "draft" as const,
  resultsPublished: true,
  answerableQuestions: 3,
  closesAt: days(7),
  now: NOW,
};

describe("decideEdit", () => {
  it("lets only a draft's questions change", () => {
    expect(decideEdit("draft")).toEqual({ ok: true });
    expect(decideEdit("open")).toEqual({ ok: false, reason: "not_draft" });
    expect(decideEdit("closed")).toEqual({ ok: false, reason: "not_draft" });
  });
});

describe("decideOpen", () => {
  it("opens a draft with questions once results are published", () => {
    expect(decideOpen(ready)).toEqual({ ok: true, closesAt: days(7) });
  });

  it("closes 14 days after opening unless told otherwise", () => {
    expect(decideOpen({ ...ready, closesAt: null })).toEqual({
      ok: true,
      closesAt: days(14),
    });
  });

  it("refuses before the competition's results are published", () => {
    expect(decideOpen({ ...ready, resultsPublished: false })).toEqual({
      ok: false,
      reason: "results_not_published",
    });
  });

  it("refuses a survey with nothing to answer", () => {
    expect(decideOpen({ ...ready, answerableQuestions: 0 })).toEqual({
      ok: false,
      reason: "no_questions",
    });
  });

  it("needs a closing time after now and at most 90 days away", () => {
    for (const closesAt of [NOW, days(-1), days(90.001)]) {
      expect(decideOpen({ ...ready, closesAt })).toEqual({
        ok: false,
        reason: "invalid_closes_at",
      });
    }
    expect(decideOpen({ ...ready, closesAt: days(90) }).ok).toBe(true);
  });

  it("opens a survey only once", () => {
    for (const status of ["open", "closed"] as const) {
      expect(decideOpen({ ...ready, status })).toEqual({
        ok: false,
        reason: "not_draft",
      });
    }
  });

  it("names the first problem when there are several", () => {
    expect(
      decideOpen({
        ...ready,
        resultsPublished: false,
        answerableQuestions: 0,
        closesAt: days(-1),
      })
    ).toEqual({ ok: false, reason: "results_not_published" });
  });
});

describe("decideClose", () => {
  it("closes an open survey, and closing again changes nothing", () => {
    expect(decideClose("open")).toEqual({ ok: true, changed: true });
    expect(decideClose("closed")).toEqual({ ok: true, changed: false });
  });

  it("refuses to close a draft, which was never sent", () => {
    expect(decideClose("draft")).toEqual({ ok: false, reason: "not_open" });
  });
});

describe("effectiveStatus", () => {
  it("treats an open survey past its closing time as closed", () => {
    expect(effectiveStatus({ status: "open", closesAt: days(1) }, NOW)).toBe(
      "open"
    );
    expect(effectiveStatus({ status: "open", closesAt: NOW }, NOW)).toBe(
      "closed"
    );
    expect(effectiveStatus({ status: "draft", closesAt: null }, NOW)).toBe(
      "draft"
    );
  });
});

describe("decideAnswer", () => {
  const open = { status: "open" as const, closesAt: days(1), now: NOW };

  it("lets an invited person answer an open survey once", () => {
    expect(decideAnswer({ ...open, respondedAt: null })).toEqual({ ok: true });
    expect(decideAnswer({ ...open, respondedAt: days(-1) })).toEqual({
      ok: false,
      reason: "already_responded",
    });
  });

  it("refuses after the survey closes, by hand or by time", () => {
    expect(
      decideAnswer({ ...open, status: "closed", respondedAt: null })
    ).toEqual({ ok: false, reason: "survey_closed" });
    expect(decideAnswer({ ...open, now: days(1), respondedAt: null })).toEqual({
      ok: false,
      reason: "survey_closed",
    });
    expect(
      decideAnswer({ ...open, now: days(2), respondedAt: days(-1) })
    ).toEqual({ ok: false, reason: "survey_closed" });
  });

  it("hides a draft as if it didn't exist", () => {
    expect(
      decideAnswer({
        status: "draft",
        closesAt: null,
        now: NOW,
        respondedAt: null,
      })
    ).toEqual({ ok: false, reason: "not_found" });
  });
});
