// Test helpers for the reminders module. Tests only: nothing in the app
// imports this file.
//
// The first reminder, entry_submission_due, reads its deadline from a
// competition's key dates (#70, #71) and who owes it from registrations
// (#78, #81, #75) and entries (#85). Until those tables exist, tests run the
// reminder mechanism with a stand-in for it: the same name, event and
// setting, with a deadline, offsets and debtors the test sets.

import type { Actor } from "../../actor";
import type { UseCaseContext } from "../../use-cases";
import type { ReminderDefinition, ReminderRegistry } from "./registry";

/** The worker, as it runs reminder jobs and scheduling. */
export const SYSTEM: Actor = { kind: "system", process: "worker" };

/** The competition the stand-in reminders belong to. */
export const COMPETITION_ID = "01950000-0000-7000-8000-000000000001";

/** 23:59 IST on 13 February 2027: the test world's submission deadline. */
export const DEADLINE = new Date("2027-02-13T18:29:00.000Z");

/** The use-case context of the worker, over a harness's deps. */
export function systemContext(deps: Omit<UseCaseContext, "actor">) {
  return { ...deps, actor: SYSTEM } satisfies UseCaseContext;
}

export type StandInReminder = {
  /** What the reminder's deadline is now; null for none. */
  deadline: Date | null;
  /** The hours before the deadline it fires at, as its setting holds them. */
  offsets: number[];
  /** The users who owe the deadline now. */
  debtors: string[];
  /** Makes the next `owes` call throw, as a failing query would. */
  failNextOwes: boolean;
  definition: ReminderDefinition;
  registry: ReminderRegistry;
};

/**
 * entry_submission_due with its data stood in for. Change `deadline`,
 * `offsets` or `debtors` at any point; the reminder reads them when it is
 * scheduled or run, as the real one reads its tables.
 */
export function standInEntrySubmissionDue(
  initial: { deadline?: Date | null; offsets?: number[]; debtors?: string[] } = {},
  name = "entry_submission_due"
): StandInReminder {
  const definition: ReminderDefinition = {
    name,
    subjectType: "competition",
    offsetsSetting: "reminders.entrySubmissionDueOffsets",
    event: "reminder.entry_submission_due",
    deadlineOf: async () => stand.deadline,
    owes: async () => {
      if (stand.failNextOwes) {
        stand.failNextOwes = false;
        throw new Error("Stand-in: the debtors query failed");
      }
      return stand.debtors;
    },
  };
  const stand: StandInReminder = {
    deadline: initial.deadline === undefined ? DEADLINE : initial.deadline,
    offsets: initial.offsets ?? [72, 24],
    debtors: initial.debtors ?? [],
    failNextOwes: false,
    definition,
    registry: {
      definitions: [definition],
      offsetsFor: async () => stand.offsets,
    },
  };
  return stand;
}
