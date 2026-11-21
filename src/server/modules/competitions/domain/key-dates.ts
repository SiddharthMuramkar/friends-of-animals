// The instants a competition runs on. #71's status changes are scheduled
// from these, so their kinds are the hook it builds on.

import { schoolsTakePart, type Participation } from "./vocabulary";

/** In timeline order. */
export const KEY_DATE_KINDS = [
  "registration_opens",
  "registration_closes",
  "submissions_close",
  "school_round_closes",
] as const;
export type KeyDateKind = (typeof KEY_DATE_KINDS)[number];

export type KeyDates = Partial<Record<KeyDateKind, Date>>;

export type KeyDateProblem =
  | { field: KeyDateKind; code: "required" | "not_applicable" }
  | { field: KeyDateKind; code: "must_follow"; other: KeyDateKind };

/**
 * Each date must come after the one before it; `strict: false` allows the
 * same instant (submissions may close as registration closes).
 */
const ORDER: readonly {
  later: KeyDateKind;
  earlier: KeyDateKind;
  strict: boolean;
}[] = [
  { later: "registration_closes", earlier: "registration_opens", strict: true },
  { later: "submissions_close", earlier: "registration_closes", strict: false },
  { later: "school_round_closes", earlier: "submissions_close", strict: true },
];

/** What stops these dates from being published, in timeline order. */
export function keyDateProblems(
  dates: KeyDates,
  participation: Participation
): KeyDateProblem[] {
  const schools = schoolsTakePart(participation);
  const problems: KeyDateProblem[] = [];
  for (const kind of KEY_DATE_KINDS) {
    const applies = kind !== "school_round_closes" || schools;
    const at = dates[kind];
    if (!applies) {
      if (at) problems.push({ field: kind, code: "not_applicable" });
      continue;
    }
    if (!at) {
      problems.push({ field: kind, code: "required" });
      continue;
    }
    const rule = ORDER.find((r) => r.later === kind);
    const before = rule && dates[rule.earlier];
    if (rule && before) {
      const ok = rule.strict
        ? at.getTime() > before.getTime()
        : at.getTime() >= before.getTime();
      if (!ok)
        problems.push({
          field: kind,
          code: "must_follow",
          other: rule.earlier,
        });
    }
  }
  return problems;
}

/** The dates that are set, in timeline order. */
export function orderedKeyDates(
  dates: KeyDates
): { kind: KeyDateKind; at: Date }[] {
  return KEY_DATE_KINDS.flatMap((kind) => {
    const at = dates[kind];
    return at ? [{ kind, at }] : [];
  });
}
