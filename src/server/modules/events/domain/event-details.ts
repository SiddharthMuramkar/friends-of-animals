// What staff enter for an event or campaign (#125): when, where, how many
// places and who may register. The admin form's Server Action converts IST
// date-times to instants and hands the rest over as typed; this schema
// checks every field and the rules between them. Problems are reported as
// codes on the field they belong to, for the form to show next to it.
//
// The description is plain multiline text. The use case passes every
// public string through the shared markup sanitiser (#111) on writing.
//
// Pure: no I/O, no "server-only", no `@/` imports.

import { z } from "zod";

import { safeHref } from "../../../rich-text/href";
import { EVENT_KINDS } from "./event-status";

/** Who may register: people holding the member role, or anyone signed in. */
export const EVENT_AUDIENCES = ["members", "signed_in"] as const;

export type EventAudience = (typeof EVENT_AUDIENCES)[number];

export const EVENT_LIMITS = {
  titleMin: 3,
  titleMax: 120,
  summaryMax: 280,
  descriptionMax: 20_000,
  venueNameMax: 120,
  addressMax: 300,
  cityMax: 80,
  capacityMax: 100_000,
} as const;

/** India Post PIN codes: six digits, the first not 0. */
const PIN_CODE = /^[1-9][0-9]{5}$/;

/** Trimmed text where blank means "not given". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === null || value === "" ? null : value));

const pinCode = z
  .string()
  .trim()
  .nullable()
  .transform((value) => (value === null || value === "" ? null : value))
  .pipe(z.string().regex(PIN_CODE).nullable());

const onlineUrl = z
  .string()
  .trim()
  .nullable()
  .transform((value) => (value === null || value === "" ? null : value))
  .pipe(
    z
      .string()
      .refine(
        (value) =>
          value.startsWith("https://") &&
          URL.canParse(value) &&
          safeHref(value) !== null
      )
      .nullable()
  );

export const eventDetailsSchema = z
  .object({
    kind: z.enum(EVENT_KINDS),
    title: z
      .string()
      .trim()
      .min(EVENT_LIMITS.titleMin)
      .max(EVENT_LIMITS.titleMax),
    summary: z.string().trim().min(1).max(EVENT_LIMITS.summaryMax),
    description: z.string().max(EVENT_LIMITS.descriptionMax),
    startsAt: z.date(),
    endsAt: z.date(),
    venueName: optionalText(EVENT_LIMITS.venueNameMax),
    address: optionalText(EVENT_LIMITS.addressMax),
    city: optionalText(EVENT_LIMITS.cityMax),
    pinCode,
    onlineUrl,
    /** null: unlimited places. */
    capacity: z.int().min(1).max(EVENT_LIMITS.capacityMax).nullable(),
    audience: z.enum(EVENT_AUDIENCES),
    /** null: registration opens when the event is published. */
    registrationOpensAt: z.date().nullable(),
    /** null: registration closes when the event starts. */
    registrationClosesAt: z.date().nullable(),
    waitlistEnabled: z.boolean(),
  })
  .superRefine((details, ctx) => {
    const problem = (path: keyof typeof details, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });

    if (details.endsAt.getTime() <= details.startsAt.getTime()) {
      problem("endsAt", "ends_before_start");
    }

    if (details.venueName !== null && details.city === null) {
      problem("city", "city_required");
    } else if (
      details.kind === "event" &&
      details.venueName === null &&
      details.onlineUrl === null
    ) {
      problem("venueName", "place_required");
    }

    const closesAt = details.registrationClosesAt ?? details.startsAt;
    if (
      details.registrationOpensAt !== null &&
      details.registrationOpensAt.getTime() >= closesAt.getTime()
    ) {
      problem("registrationOpensAt", "registration_window_empty");
    }
    if (
      details.registrationClosesAt !== null &&
      details.registrationClosesAt.getTime() > details.endsAt.getTime()
    ) {
      problem("registrationClosesAt", "registration_closes_after_end");
    }
  })
  // With unlimited places nobody waits, so a waitlist would never be used.
  .transform((details) =>
    details.capacity === null ? { ...details, waitlistEnabled: false } : details
  );

export type EventDetailsInput = z.input<typeof eventDetailsSchema>;
export type EventDetails = z.output<typeof eventDetailsSchema>;

export type PublishProblem = "starts_in_past";

/**
 * Why an event can't be published at `now`, or kept published after an
 * edit: it must not have started. Empty when it can.
 */
export function publishableProblems(
  details: Pick<EventDetails, "startsAt">,
  now: Date
): PublishProblem[] {
  return details.startsAt.getTime() <= now.getTime() ? ["starts_in_past"] : [];
}
