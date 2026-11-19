import { isSampleContentEnabled, placeholder } from "@/lib/site";

import { SAMPLE_CERTIFICATE } from "./certificate";
import {
  type Competition,
  competitionSchema,
  type Impact,
  impactSchema,
} from "./model";

type EnvLike = Parameters<typeof isSampleContentEnabled>[0];

/**
 * Typed sample content for test sites only (owner decision 1): never served in
 * production, and every render shows <SampleTag>. Fees stay placeholders:
 * FOA has not set any.
 */

const fees = [
  {
    route: "INSTITUTION",
    conductMode: "PHYSICAL_AT_INSTITUTION",
    currency: "INR",
    feeBaseMinor: placeholder("feeSchool"),
  },
  {
    route: "INDIVIDUAL",
    conductMode: "INDEPENDENT",
    currency: "INR",
    feeBaseMinor: placeholder("feeIndividual"),
  },
] as const;

const ages = [
  { label: "Group A", minAge: 5, maxAge: 8 },
  { label: "Group B", minAge: 9, maxAge: 12 },
  { label: "Group C", minAge: 13, maxAge: 17 },
];

export const SAMPLE_COMPETITIONS: readonly Competition[] = competitionSchema
  .array()
  .parse([
    {
      code: "NEIGH27",
      slug: "neighbours-on-my-street",
      name: "Neighbours on My Street",
      theme:
        "Draw, paint or photograph an animal that shares your street, and show one kind thing you do for it.",
      status: "REGISTRATION_OPEN",
      coverImageId: "sn-myna-goregaon",
      disciplines: ["DRAWING", "PAINTING", "PHOTOGRAPHY"],
      ageGroups: ages,
      routes: fees,
      ageCutoffDate: "2027-01-01",
      registrationOpensAt: "2026-11-01T09:00:00+05:30",
      registrationClosesAt: "2027-01-15T23:59:00+05:30",
      confirmationDeadline: "2027-01-22T23:59:00+05:30",
      conductStartsAt: "2027-01-25T09:00:00+05:30",
      conductEndsAt: "2027-02-05T17:00:00+05:30",
      submissionOpensAt: "2027-01-25T09:00:00+05:30",
      submissionClosesAt: "2027-02-10T23:59:00+05:30",
      shortlistSubmissionClosesAt: "2027-02-20T23:59:00+05:30",
    },
    {
      code: "WATER27",
      slug: "a-bowl-of-water",
      name: "A Bowl of Water",
      theme:
        "Summer is coming. Show how a bowl of clean water in the shade helps the birds and animals near you.",
      status: "PUBLISHED",
      coverImageId: "se-water-junglemyna",
      disciplines: ["DRAWING", "ESSAY"],
      ageGroups: ages,
      routes: fees,
      ageCutoffDate: "2027-04-01",
      registrationOpensAt: "2027-02-01T09:00:00+05:30",
      registrationClosesAt: "2027-03-31T23:59:00+05:30",
      confirmationDeadline: "2027-04-07T23:59:00+05:30",
      conductStartsAt: "2027-04-10T09:00:00+05:30",
      conductEndsAt: "2027-04-20T17:00:00+05:30",
      submissionOpensAt: "2027-04-10T09:00:00+05:30",
      submissionClosesAt: "2027-04-25T23:59:00+05:30",
      shortlistSubmissionClosesAt: "2027-05-05T23:59:00+05:30",
    },
    {
      code: "SKIES26",
      slug: "kinder-skies",
      name: "Kinder Skies",
      theme:
        "Kites and birds share the sky. Make a picture or a craft that shows how both can fly safely.",
      status: "FOA_JUDGING",
      coverImageId: "se-kites-uttarayan",
      disciplines: ["DRAWING", "PAINTING", "CRAFT"],
      ageGroups: ages,
      routes: fees,
      ageCutoffDate: "2026-08-01",
      registrationOpensAt: "2026-06-01T09:00:00+05:30",
      registrationClosesAt: "2026-08-15T23:59:00+05:30",
      confirmationDeadline: "2026-08-22T23:59:00+05:30",
      conductStartsAt: "2026-09-01T09:00:00+05:30",
      conductEndsAt: "2026-09-15T17:00:00+05:30",
      submissionOpensAt: "2026-09-01T09:00:00+05:30",
      submissionClosesAt: "2026-09-30T23:59:00+05:30",
      shortlistSubmissionClosesAt: "2026-10-15T23:59:00+05:30",
    },
  ]);

/** Sample counters: values chosen to show both rounding and suppression. */
export const SAMPLE_IMPACT: Impact = impactSchema.parse({
  asOf: "2026-11-18",
  counters: [
    { key: "participants", value: 1249 },
    { key: "institutions", value: 38 },
    { key: "statesReached", value: 12 },
    { key: "competitions", value: 3 },
  ],
});

export function getSampleCompetitions(env?: EnvLike): readonly Competition[] {
  return isSampleContentEnabled(env) ? SAMPLE_COMPETITIONS : [];
}

export function getSampleImpact(env?: EnvLike): Impact | null {
  return isSampleContentEnabled(env) ? SAMPLE_IMPACT : null;
}

export type SampleCertificate = typeof SAMPLE_CERTIFICATE & {
  competition: Competition;
};

/**
 * The sample certificate and the competition it is for, off production only
 * (the home page then shows neutral placeholder text instead).
 */
export function getSampleCertificate(env?: EnvLike): SampleCertificate | null {
  const competition = getSampleCompetitions(env).find(
    (c) => c.code === SAMPLE_CERTIFICATE.competitionCode
  );
  return competition ? { ...SAMPLE_CERTIFICATE, competition } : null;
}
