import { z } from "zod";

import { SITE_IMAGE_IDS } from "@/lib/images/credits";
import { isPlaceholder, type Placeholder } from "@/lib/site";

/** Data shapes for typed sample content. */

export const COMPETITION_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "IN_PROGRESS",
  "SCHOOL_JUDGING",
  "FOA_JUDGING",
  "RESULTS_PENDING_APPROVAL",
  "RESULTS_PUBLISHED",
  "ARCHIVED",
  "CANCELLED",
] as const;
export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];

export const DISCIPLINES = [
  "DRAWING",
  "PAINTING",
  "ART",
  "CRAFT",
  "ESSAY",
  "PHOTOGRAPHY",
  "VIDEOGRAPHY",
] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const PARTICIPATION_ROUTES = ["INSTITUTION", "INDIVIDUAL"] as const;
export type ParticipationRoute = (typeof PARTICIPATION_ROUTES)[number];

const placeholderSchema = z.custom<Placeholder>(isPlaceholder);
/** Fee in paise, or a placeholder until FOA sets it (never invented). */
const feeSchema = z.union([z.int().min(0), placeholderSchema]);
export type Fee = z.infer<typeof feeSchema>;

const at = z.iso.datetime({ offset: true });

const routeSchema = z.strictObject({
  route: z.enum(PARTICIPATION_ROUTES),
  conductMode: z.enum(["PHYSICAL_AT_INSTITUTION", "ONLINE", "INDEPENDENT"]),
  currency: z.literal("INR"),
  feeBaseMinor: feeSchema,
});

const ageGroupSchema = z.strictObject({
  label: z.string().min(1),
  minAge: z.int().min(3),
  maxAge: z.int().max(30),
});

export const competitionSchema = z
  .strictObject({
    code: z.string().regex(/^[A-Z]{3,6}\d{2}$/),
    slug: z.string().regex(/^[a-z0-9-]{3,80}$/),
    name: z.string().min(1),
    theme: z.string().min(1),
    status: z.enum(COMPETITION_STATUSES),
    coverImageId: z.enum(SITE_IMAGE_IDS),
    disciplines: z.array(z.enum(DISCIPLINES)).min(1),
    ageGroups: z.array(ageGroupSchema).min(1),
    routes: z.array(routeSchema).min(1),
    ageCutoffDate: z.iso.date(),
    registrationOpensAt: at,
    registrationClosesAt: at,
    confirmationDeadline: at,
    conductStartsAt: at,
    conductEndsAt: at,
    submissionOpensAt: at,
    submissionClosesAt: at,
    shortlistSubmissionClosesAt: at.optional(),
  })
  .superRefine((c, ctx) => {
    const t = (iso: string) => Date.parse(iso);
    const order = (a: keyof typeof c, b: keyof typeof c, strict: boolean) => {
      const x = t(c[a] as string);
      const y = t(c[b] as string);
      if (strict ? !(x < y) : !(x <= y))
        ctx.addIssue({
          code: "custom",
          path: [b],
          message: `${a} must be ${strict ? "before" : "on or before"} ${b}`,
        });
    };
    // Date-order rules.
    order("registrationOpensAt", "registrationClosesAt", true);
    order("registrationClosesAt", "confirmationDeadline", false);
    order("confirmationDeadline", "submissionClosesAt", false);
    order("registrationClosesAt", "conductStartsAt", false);
    order("conductStartsAt", "conductEndsAt", false);
    order("conductEndsAt", "submissionClosesAt", false);
    order("conductStartsAt", "submissionOpensAt", false);
    order("submissionOpensAt", "submissionClosesAt", true);
    const school = c.routes.some((r) => r.route === "INSTITUTION");
    if (school !== (c.shortlistSubmissionClosesAt !== undefined))
      ctx.addIssue({
        code: "custom",
        path: ["shortlistSubmissionClosesAt"],
        message: "a shortlist deadline is set if and only if schools take part",
      });
    else if (school)
      order("submissionClosesAt", "shortlistSubmissionClosesAt", true);
  });

export type Competition = z.infer<typeof competitionSchema>;

/** Pilot-visible impact counters. */
export const COUNTER_KEYS = [
  "participants",
  "institutions",
  "competitions",
  "statesReached",
  "artworksShowcased",
  "certificatesIssued",
] as const;
export type CounterKey = (typeof COUNTER_KEYS)[number];

export const impactSchema = z.strictObject({
  asOf: z.iso.date(),
  counters: z
    .array(z.strictObject({ key: z.enum(COUNTER_KEYS), value: z.int().min(0) }))
    .min(1),
});
export type Impact = z.infer<typeof impactSchema>;
