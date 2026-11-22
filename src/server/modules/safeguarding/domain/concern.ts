// What the public "report a concern" form takes (#116). It works without an
// account, so the shape is small and every free-text field is capped. The
// reporter may stay anonymous: then no name or contact is kept, even if one
// was typed before the box was ticked. A report with neither a name nor a
// contact is anonymous whatever the box said, so the flag always means "we
// can't tell who sent this or reach them".
//
// The text is stored encrypted (#58); this file only checks and shapes it.
// No attachments: the form tells people how to report images instead.
//
// Pure, and loads under plain Node.

import { z } from "zod";

import { MIN_FILL_MS } from "../../../../lib/form-fill-time";

/** What the concern is about. Stored as text; labels live in messages. */
export const CONCERN_CATEGORIES = [
  "child_safety",
  "suspected_abuse",
  "inappropriate_contact",
  "privacy_exposure",
  "bullying",
  "adult_conduct",
  "other",
] as const;

export type ConcernCategory = (typeof CONCERN_CATEGORIES)[number];

export const DESCRIPTION_MAX = 5000;
export const SUBJECT_DETAILS_MAX = 1000;
export const REPORTER_NAME_MAX = 120;
export const REPORTER_CONTACT_MAX = 200;
/** The child the concern is about is under 18. */
export const SUBJECT_AGE_MAX = 17;

/** Blank, null and missing all mean "not given". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((text) => (text ? text : null));

const concernInputSchema = z.strictObject({
  category: z.enum(CONCERN_CATEGORIES),
  description: z.string().trim().min(1).max(DESCRIPTION_MAX),
  /** Who the concern is about: a name, a school, a username. */
  subjectDetails: optionalText(SUBJECT_DETAILS_MAX),
  /** Roughly how old that child is, if the reporter knows. */
  subjectAge: z.int().min(0).max(SUBJECT_AGE_MAX).nullish(),
  /** The reporter says they are a child themselves. */
  reporterIsChild: z.boolean(),
  anonymous: z.boolean(),
  reporterName: optionalText(REPORTER_NAME_MAX),
  /** An email address or phone number, as typed. */
  reporterContact: optionalText(REPORTER_CONTACT_MAX),
});

export type ConcernField = keyof z.input<typeof concernInputSchema>;

/** A concern ready to store: every optional field is a value or null. */
export type Concern = {
  category: ConcernCategory;
  description: string;
  subjectDetails: string | null;
  subjectAge: number | null;
  reporterIsChild: boolean;
  anonymous: boolean;
  reporterName: string | null;
  reporterContact: string | null;
};

export type ConcernParse =
  | { ok: true; concern: Concern }
  | { ok: false; fields: ConcernField[] };

/**
 * Checks what the form sent. On failure, lists the fields to mark, in form
 * order, and never echoes their content.
 */
export function parseConcern(input: unknown): ConcernParse {
  const parsed = concernInputSchema.safeParse(input);
  if (!parsed.success) {
    const fields = new Set<ConcernField>();
    for (const issue of parsed.error.issues) {
      const [field] = issue.path;
      if (typeof field === "string" && field in concernInputSchema.shape) {
        fields.add(field as ConcernField);
      }
    }
    const order = Object.keys(concernInputSchema.shape) as ConcernField[];
    return { ok: false, fields: order.filter((field) => fields.has(field)) };
  }
  const value = parsed.data;
  const anonymous =
    value.anonymous ||
    (value.reporterName === null && value.reporterContact === null);
  return {
    ok: true,
    concern: {
      category: value.category,
      description: value.description,
      subjectDetails: value.subjectDetails,
      subjectAge: value.subjectAge ?? null,
      reporterIsChild: value.reporterIsChild,
      anonymous,
      reporterName: anonymous ? null : value.reporterName,
      reporterContact: anonymous ? null : value.reporterContact,
    },
  };
}

/**
 * Whether a form looks like a person sent it. A bot that fills the hidden
 * `website` field, or sends the form within MIN_FILL_MS of its human check
 * being issued (`startedAt`, which the server signed), is dropped: the use
 * case answers as if it worked and keeps nothing. The same screen as
 * #113's contact form.
 */
export function screenConcern(input: {
  honeypot: unknown;
  startedAt: Date;
  now: Date;
}): "accept" | "drop" {
  const { honeypot, startedAt, now } = input;
  if (typeof honeypot === "string" && honeypot.trim() !== "") return "drop";
  if (now.getTime() - startedAt.getTime() < MIN_FILL_MS) return "drop";
  return "accept";
}
