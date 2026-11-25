// Which work each discipline takes (#85, #86). A code registry rather than
// a table: no screen edits it yet, and FOA's own limits arrive through
// HR-37.
//
//   drawing, painting, art, craft, photography  a picture (DEFAULT_IMAGE_RULE)
//   videography                                 a video (DEFAULT_VIDEO_RULE)
//   essay                                       typed text (DEFAULT_ESSAY_RULE)
//                                               or a PDF (DEFAULT_DOCUMENT_RULE)
//
// Pure: no I/O, no "server-only", so the upload form can import it.

import type { Discipline } from "../competitions/domain/vocabulary";
import {
  DEFAULT_DOCUMENT_RULE,
  DEFAULT_IMAGE_RULE,
  DEFAULT_VIDEO_RULE,
  type UploadRule,
} from "./domain/upload-rules";

/** The disciplines whose work is a picture or a scan of it. */
export const IMAGE_DISCIPLINES = [
  "drawing",
  "painting",
  "art",
  "craft",
  "photography",
] as const satisfies readonly Discipline[];

export type ImageDiscipline = (typeof IMAGE_DISCIPLINES)[number];

export function isImageDiscipline(
  discipline: string
): discipline is ImageDiscipline {
  return (IMAGE_DISCIPLINES as readonly string[]).includes(discipline);
}

/** How a discipline's work is submitted. */
export type EntryFormat = "image" | "video" | "essay";

/** The format of `discipline`'s work, or null for an unknown one. */
export function formatOf(discipline: string): EntryFormat | null {
  if (isImageDiscipline(discipline)) return "image";
  if (discipline === "videography") return "video";
  if (discipline === "essay") return "essay";
  return null;
}

/** Whether entries can be submitted in `discipline` at all. */
export function isEntryDiscipline(
  discipline: string
): discipline is Discipline {
  return formatOf(discipline) !== null;
}

/**
 * The rule an uploaded file in `discipline` must meet: a picture, a video,
 * or an essay's PDF. Null for an unknown discipline.
 */
export function uploadRuleFor(discipline: string): UploadRule | null {
  switch (formatOf(discipline)) {
    case "image":
      return DEFAULT_IMAGE_RULE;
    case "video":
      return DEFAULT_VIDEO_RULE;
    case "essay":
      return DEFAULT_DOCUMENT_RULE;
    default:
      return null;
  }
}

export type DisciplineChoice =
  | { ok: true; discipline: Discipline }
  | { ok: false; error: "discipline_not_offered" | "discipline_required" };

/**
 * The discipline a submission is in: the entry's own once it has one
 * (chosen with its first submission, never changed); otherwise the one
 * asked for, if the competition holds it; otherwise the competition's only
 * discipline.
 */
export function chooseDiscipline({
  offered,
  asked,
  current,
}: {
  offered: readonly string[];
  asked?: string | undefined;
  current?: string | undefined;
}): DisciplineChoice {
  if (current !== undefined && isEntryDiscipline(current)) {
    return { ok: true, discipline: current };
  }
  const open = offered.filter(isEntryDiscipline);
  if (asked !== undefined && asked !== "") {
    return isEntryDiscipline(asked) && open.includes(asked)
      ? { ok: true, discipline: asked }
      : { ok: false, error: "discipline_not_offered" };
  }
  if (open.length === 1) return { ok: true, discipline: open[0]! };
  return {
    ok: false,
    error: open.length === 0 ? "discipline_not_offered" : "discipline_required",
  };
}
