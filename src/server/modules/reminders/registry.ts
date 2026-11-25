// The reminder registry (#84): every named reminder the platform sends.
// A reminder is a deadline, the settings that say how many hours before it
// a reminder goes out, who owes it when the reminder runs, and the message
// template it is sent with (routes on `reminder.due`). The mechanism
// (./schedule-reminders.ts, ./run-reminder.ts) is the same for all.
//
// Adding a reminder (#90 school-round shortlist, #93 dispatch, #125
// events):
//   1. a file in ./definitions/ exporting one ReminderDefinition;
//   2. one line in REMINDERS below;
//   3. its hour settings in modules/settings/catalogue.ts (group
//      "reminders"), with their copy in messages/en-IN/adminSettings.json;
//   4. a custom migration with its template (email, in_app, sms) and its
//      two routes on `reminder.due` (audiences `reminder_registrants` and
//      `reminder_contacts`), like drizzle/*_84_reminder_messages.sql.
// A subject other than a competition (#125) also adds its type to
// ReminderSubjectType and an audience kind to ReminderAudience.
//
// Loads under plain Node (the worker): relative imports only.

import type { AppDb } from "../../db/app-db";
import type { Recipient } from "../announcements/domain/audience";
import type { SettingKey } from "../settings/catalogue";
import { schoolRoundShortlistDue } from "./definitions/school-round-shortlist-due";
import { entrySubmissionDue } from "./definitions/entry-submission-due";
import type { Deadline } from "./domain/schedule";

/** What a reminder's deadline belongs to. */
export type ReminderSubjectType = "competition";

/** A setting holding the hours before the deadline one reminder goes at. */
export type ReminderOffsetSetting = Extract<SettingKey, `reminders.${string}`>;

/** A role in a competition's roster (announcements/domain/audience.ts). */
export type RosterRole = Recipient["roles"][number];

/**
 * Who owes a deadline now, as people the delivery reaches. For a
 * competition: groups of its registrations, each reminding only the given
 * roles among the people those registrations reach (a minor's guardian,
 * never the minor). A person in several groups gets one copy.
 */
export type ReminderAudience = {
  kind: "competition_roster";
  competitionId: string;
  groups: readonly {
    registrationIds: ReadonlySet<string>;
    roles: readonly RosterRole[];
  }[];
};

export type ReminderDefinition = {
  /** Unique, lower snake case; stored as reminder_job.reminder_name. */
  name: string;
  subjectType: ReminderSubjectType;
  /** One reminder per setting with hours above 0. */
  offsetSettings: readonly ReminderOffsetSetting[];
  /** The message template; its routes are on `reminder.due`. */
  templateKey: string;
  /** The template variables `values` gives, beyond the deadline's. */
  variables: readonly string[];
  /** The deadline as it stands now. */
  deadlineOf(db: AppDb, subjectId: string): Promise<Deadline>;
  /** The subjects with a deadline ahead, for the hourly sync. */
  subjectsToSync(db: AppDb, now: Date): Promise<string[]>;
  /** Who owes the deadline now: checked when the reminder runs. */
  owes(
    db: AppDb,
    input: { subjectId: string; deadlineAt: Date; now: Date }
  ): Promise<ReminderAudience>;
  /** The subject's template values, such as the competition's name. */
  values(db: AppDb, subjectId: string): Promise<Record<string, string>>;
};

export const REMINDERS: readonly ReminderDefinition[] = [
  entrySubmissionDue,
  schoolRoundShortlistDue,
];

/** The reminder stored under `name`, if this code still has it. */
export function reminderNamed(name: string): ReminderDefinition | undefined {
  return REMINDERS.find((reminder) => reminder.name === name);
}

/** Every reminder about one type of subject. */
export function remindersAbout(
  subjectType: ReminderSubjectType
): ReminderDefinition[] {
  return REMINDERS.filter((reminder) => reminder.subjectType === subjectType);
}
