// Which files each discipline takes (#85). A code registry rather than a
// table: no screen edits it yet, and FOA's own limits arrive through HR-37.
// Every image discipline uses DEFAULT_IMAGE_RULE until then. Essay and
// videography take other kinds of file (#86), so they have no image rule.
//
// Pure: no I/O, no "server-only", so the upload form can import it.

import type { Discipline } from "../competitions/domain/vocabulary";
import { DEFAULT_IMAGE_RULE, type UploadRule } from "./domain/upload-rules";

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

/** The image rule for `discipline`, or null if its work isn't an image. */
export function uploadRuleFor(discipline: string): UploadRule | null {
  return isImageDiscipline(discipline) ? DEFAULT_IMAGE_RULE : null;
}

export type DisciplineChoice =
  | { ok: true; discipline: ImageDiscipline }
  | { ok: false; error: "discipline_not_offered" | "discipline_required" };

/**
 * The discipline an upload is in: the entry's own once it has one (chosen
 * with its first upload, never changed); otherwise the one asked for, if
 * the competition holds it and its work is a picture; otherwise the
 * competition's only picture discipline.
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
  if (current !== undefined && isImageDiscipline(current)) {
    return { ok: true, discipline: current };
  }
  const pictures = offered.filter(isImageDiscipline);
  if (asked !== undefined && asked !== "") {
    return isImageDiscipline(asked) && pictures.includes(asked)
      ? { ok: true, discipline: asked }
      : { ok: false, error: "discipline_not_offered" };
  }
  if (pictures.length === 1) return { ok: true, discipline: pictures[0]! };
  return {
    ok: false,
    error:
      pictures.length === 0 ? "discipline_not_offered" : "discipline_required",
  };
}
