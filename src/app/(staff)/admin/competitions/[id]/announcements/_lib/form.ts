// The composer's form: reading what a manager typed into announcement
// content (the event's date and time are typed in IST), and the view the
// form shows, with each field at fault marked and what was typed kept.
// Error codes, not words: the form takes its words from
// messages/en-IN/adminAnnouncements.json.

import {
  instantToIstLocal,
  istLocalToInstant,
} from "@/server/modules/competitions/domain/ist";
import type {
  AnnouncementContent,
  AnnouncementContentInput,
} from "@/server/modules/announcements";

export const FIELDS = [
  "subject",
  "eventAt",
  "confirmedTheme",
  "permittedMaterials",
  "duration",
  "submissionSteps",
  "physicalArtworkRequirements",
  "deadlines",
  "helpContacts",
  "message",
] as const;

export type FieldName = (typeof FIELDS)[number];

/** Why a field is refused: its own rule, or "too long or a bad character". */
export type FieldError = "subject" | "eventAt" | "field";

export type AnnouncementFormView = {
  values: Record<FieldName, string>;
  errors: Partial<Record<FieldName, FieldError>>;
  /** Problems with the whole form: `sections`, or a refusal's code. */
  alert: string[];
};

const TEXT_FIELDS = FIELDS.filter(
  (name): name is Exclude<FieldName, "eventAt"> => name !== "eventAt"
);

function isField(name: string): name is FieldName {
  return (FIELDS as readonly string[]).includes(name);
}

function blankValues(): Record<FieldName, string> {
  return Object.fromEntries(FIELDS.map((name) => [name, ""])) as Record<
    FieldName,
    string
  >;
}

/** What was typed in each field, as typed. */
export function formValues(form: FormData): Record<FieldName, string> {
  const values = blankValues();
  for (const name of FIELDS) {
    const value = form.get(name);
    values[name] = typeof value === "string" ? value : "";
  }
  return values;
}

export function readAnnouncementForm(
  form: FormData
):
  | { ok: true; content: AnnouncementContentInput }
  | { ok: false; fields: FieldName[]; values: Record<FieldName, string> } {
  const values = formValues(form);
  let eventAt: Date | null = null;
  if (values.eventAt.trim() !== "") {
    const read = istLocalToInstant(values.eventAt.trim());
    if (!read.ok) return { ok: false, fields: ["eventAt"], values };
    eventAt = read.at;
  }
  const content = Object.fromEntries(
    TEXT_FIELDS.map((name) => [name, values[name] === "" ? null : values[name]])
  ) as Omit<AnnouncementContentInput, "eventAt" | "subject">;
  return {
    ok: true,
    content: { ...content, subject: values.subject, eventAt },
  };
}

/** The form filled from saved content; a new draft starts blank. */
export function announcementFormView(
  content: AnnouncementContent | null
): AnnouncementFormView {
  const values = blankValues();
  if (content) {
    for (const name of TEXT_FIELDS) values[name] = content[name] ?? "";
    values.eventAt = content.eventAt ? instantToIstLocal(content.eventAt) : "";
  }
  return { values, errors: {}, alert: [] };
}

/** The form after a refusal naming `fields`, what was typed kept. */
export function formViewForRefusal(
  typed: Partial<Record<FieldName, string>>,
  fields: readonly string[]
): AnnouncementFormView {
  const view: AnnouncementFormView = {
    values: { ...blankValues(), ...typed },
    errors: {},
    alert: [],
  };
  for (const name of fields) {
    if (!isField(name)) view.alert.push(name);
    else if (name === "subject" || name === "eventAt") view.errors[name] = name;
    else view.errors[name] = "field";
  }
  return view;
}
