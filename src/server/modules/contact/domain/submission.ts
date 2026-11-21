// What the public contact form may send, and the checks that need no
// database (#113): field rules, the bot screen (a hidden field and a
// minimum time to fill the form), the limits per IP and per email address,
// and the format of the reference the sender is given.
//
// No phone number is collected: replies go by email, so the form keeps
// one less piece of personal data.
//
// Loads under plain Node (seed script), so no "server-only" here.

import { z } from "zod";

import { CONTACT_TOPICS, type ContactTopic } from "./routing";

/** Longest value each field accepts, after trimming. */
export const CONTACT_FIELD_LIMITS = {
  name: 100,
  email: 254,
  organisation: 150,
  subject: 150,
  message: 5000,
} as const;

const required = (max: number) => z.string().trim().min(1).max(max);

const contactSubmissionSchema = z.object({
  topic: z.enum(CONTACT_TOPICS),
  name: required(CONTACT_FIELD_LIMITS.name),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(CONTACT_FIELD_LIMITS.email)
    .pipe(z.email()),
  organisation: z
    .string()
    .trim()
    .max(CONTACT_FIELD_LIMITS.organisation)
    .optional()
    .transform((value) => (value ? value : null)),
  subject: required(CONTACT_FIELD_LIMITS.subject),
  message: required(CONTACT_FIELD_LIMITS.message),
});

export type ContactSubmissionField =
  | keyof typeof CONTACT_FIELD_LIMITS
  | "topic";

export type ContactSubmission = {
  topic: ContactTopic;
  name: string;
  /** Trimmed and lower-cased, as the per-address limit counts it. */
  email: string;
  organisation: string | null;
  subject: string;
  message: string;
};

export type ParsedContactSubmission =
  | { ok: true; value: ContactSubmission }
  | { ok: false; fields: ContactSubmissionField[] };

/** The form's fields, checked; unknown fields are dropped. */
export function parseContactSubmission(
  input: unknown
): ParsedContactSubmission {
  const result = contactSubmissionSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  const fields = new Set<ContactSubmissionField>();
  for (const issue of result.error.issues) {
    const [field] = issue.path;
    if (typeof field === "string" && isField(field)) fields.add(field);
  }
  // A body that isn't an object fails at the root: every field is missing.
  if (fields.size === 0) {
    for (const field of Object.keys(contactSubmissionSchema.shape)) {
      if (isField(field) && field !== "organisation") fields.add(field);
    }
  }
  return { ok: false, fields: [...fields] };
}

function isField(name: string): name is ContactSubmissionField {
  return Object.hasOwn(contactSubmissionSchema.shape, name);
}

/** Faster than this from opening the form to sending it is a bot. */
export const MIN_FILL_MS = 3000;

/**
 * Whether a submission looks like a person sent it. A bot that fills the
 * hidden field, or sends the form within `minFillMs` of the human check
 * being issued (`startedAt`, which the server signed), is dropped: the
 * caller answers as if it worked and stores nothing.
 */
export function screenSubmission(input: {
  honeypot: string | undefined;
  startedAt: Date;
  now: Date;
  minFillMs?: number;
}): "accept" | "drop" {
  const { honeypot, startedAt, now, minFillMs = MIN_FILL_MS } = input;
  if (honeypot !== undefined && honeypot.trim() !== "") return "drop";
  if (now.getTime() - startedAt.getTime() < minFillMs) return "drop";
  return "accept";
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Defaults until FOA confirms them. */
export const CONTACT_RATE_LIMITS = {
  perIpPerHour: 5,
  perEmailPerDay: 5,
} as const;

export type ContactRateLimits = {
  perIpPerHour: number;
  perEmailPerDay: number;
};

/** One counter a submission adds to; over `max` in a window is refused. */
export type RateRule = {
  scope: "ip" | "email";
  key: string;
  max: number;
  windowMs: number;
};

/** The counters one submission from `ip` and `email` adds to. */
export function contactRateRules(
  sender: { ip: string; email: string },
  limits: ContactRateLimits = CONTACT_RATE_LIMITS
): RateRule[] {
  return [
    {
      scope: "ip",
      key: sender.ip,
      max: limits.perIpPerHour,
      windowMs: HOUR_MS,
    },
    {
      scope: "email",
      key: sender.email,
      max: limits.perEmailPerDay,
      windowMs: DAY_MS,
    },
  ];
}

/** India Standard Time is UTC+5:30 all year. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * The reference format for a message arriving at `at`: `CM-` and the IST
 * year's last two digits, then 6 random Crockford base32 symbols (the
 * shape #73's code generator takes).
 */
export function contactReferenceFormat(at: Date): {
  prefix: string;
  length: 6;
} {
  const year = new Date(at.getTime() + IST_OFFSET_MS).getUTCFullYear();
  return { prefix: `CM-${String(year % 100).padStart(2, "0")}-`, length: 6 };
}

/** A contact reference, such as `CM-27-8H3TZ0`. */
export const CONTACT_REFERENCE_PATTERN = /^CM-\d{2}-[0-9A-HJKMNP-TV-Z]{6}$/;
