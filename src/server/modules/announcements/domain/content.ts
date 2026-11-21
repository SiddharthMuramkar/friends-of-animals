// What a competition manager writes in an announcement (#84): structured
// plain-text fields, never HTML, so nothing needs the rich-text sanitiser.
// Renderers escape every value. The edge converts the composer's IST date
// and time to an instant before parsing.

import { z } from "zod";

/** Maximum characters per field, after trimming. */
export const ANNOUNCEMENT_LIMITS = {
  subject: 150,
  confirmedTheme: 300,
  permittedMaterials: 2000,
  duration: 200,
  submissionSteps: 4000,
  physicalArtworkRequirements: 2000,
  deadlines: 2000,
  helpContacts: 1000,
  message: 4000,
} as const;

/** The order sections appear in the preview, the email and the inbox. */
const SECTION_ORDER = [
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

export type AnnouncementSectionKey = (typeof SECTION_ORDER)[number];
type TextSectionKey = Exclude<AnnouncementSectionKey, "eventAt">;

const normalise = (value: string) => value.replace(/\r\n?/g, "\n").trim();
const hasNoNul = (value: string) => !value.includes("\u0000");

const requiredText = (max: number) =>
  z
    .string()
    .transform(normalise)
    .pipe(z.string().min(1).max(max).refine(hasNoNul, "contains_nul"));

const optionalText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((value) => {
      const cleaned =
        value === null || value === undefined ? "" : normalise(value);
      return cleaned === "" ? null : cleaned;
    })
    .pipe(z.string().max(max).refine(hasNoNul, "contains_nul").nullable());

export const announcementContentSchema = z
  .object({
    subject: requiredText(ANNOUNCEMENT_LIMITS.subject),
    eventAt: z
      .date()
      .nullish()
      .transform((value) => value ?? null),
    confirmedTheme: optionalText(ANNOUNCEMENT_LIMITS.confirmedTheme),
    permittedMaterials: optionalText(ANNOUNCEMENT_LIMITS.permittedMaterials),
    duration: optionalText(ANNOUNCEMENT_LIMITS.duration),
    submissionSteps: optionalText(ANNOUNCEMENT_LIMITS.submissionSteps),
    physicalArtworkRequirements: optionalText(
      ANNOUNCEMENT_LIMITS.physicalArtworkRequirements
    ),
    deadlines: optionalText(ANNOUNCEMENT_LIMITS.deadlines),
    helpContacts: optionalText(ANNOUNCEMENT_LIMITS.helpContacts),
    message: optionalText(ANNOUNCEMENT_LIMITS.message),
  })
  .refine(
    (content) => SECTION_ORDER.some((key) => content[key] !== null),
    "announcement_empty"
  );

export type AnnouncementContent = z.output<typeof announcementContentSchema>;

export type AnnouncementSection =
  | { key: "eventAt"; value: Date }
  | { key: TextSectionKey; value: string };

/** The filled sections, in reading order. Blank fields are left out. */
export function announcementSections(
  content: AnnouncementContent
): AnnouncementSection[] {
  const sections: AnnouncementSection[] = [];
  for (const key of SECTION_ORDER) {
    if (key === "eventAt") {
      if (content.eventAt !== null) {
        sections.push({ key, value: content.eventAt });
      }
      continue;
    }
    const value = content[key];
    if (value !== null) sections.push({ key, value });
  }
  return sections;
}
