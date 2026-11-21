// The blind-judging read model: everything a judge sees about an entry.
// Judges see the entry code, the discipline, the category, the age group and
// the work, and never who made it: no name, school, city, guardian, contact
// details, registration number or uploaded file name. Titles, descriptions
// and statements are left out too, because they can carry names (showing
// titles is an FOA decision, off by default).
//
// `toBlindEntryView` copies the allowed fields one by one, so whatever else a
// query returns never reaches the page. Only it makes a `BlindEntryView`.
//
// Loads under plain Node (seed script): relative imports only.

export type BlindMedia =
  | {
      kind: "image";
      url: string;
      width: number | null;
      height: number | null;
      thumbnailUrl: string | null;
    }
  | {
      kind: "video";
      url: string;
      posterUrl: string | null;
      width: number | null;
      height: number | null;
      durationMs: number | null;
    }
  /** A typed essay, already through the rich-text sanitiser. */
  | { kind: "essay_text"; html: string }
  | { kind: "document"; url: string }
  | { kind: "unavailable" };

export type BlindEntrySource = {
  entryCode: string;
  discipline: string;
  categoryLabel: string;
  /** `null` when the competition has no age groups. */
  ageGroupLabel: string | null;
  media: readonly BlindMedia[];
};

declare const blindEntryView: unique symbol;

/** Made only by `toBlindEntryView`. */
export type BlindEntryView = Readonly<BlindEntrySource> & {
  readonly [blindEntryView]: true;
};

/** Every key path a view may hold (see `keyPaths`). */
export const BLIND_ENTRY_VIEW_KEY_PATHS = [
  "entryCode",
  "discipline",
  "categoryLabel",
  "ageGroupLabel",
  "media",
  "media[].kind",
  "media[].url",
  "media[].width",
  "media[].height",
  "media[].thumbnailUrl",
  "media[].posterUrl",
  "media[].durationMs",
  "media[].html",
] as const;

export function toBlindEntryView(source: BlindEntrySource): BlindEntryView {
  const view: BlindEntrySource = {
    entryCode: source.entryCode,
    discipline: source.discipline,
    categoryLabel: source.categoryLabel,
    ageGroupLabel: source.ageGroupLabel,
    media: source.media.map(blindMedia),
  };
  return view as BlindEntryView;
}

function blindMedia(media: BlindMedia): BlindMedia {
  switch (media.kind) {
    case "image":
      return {
        kind: "image",
        url: media.url,
        width: media.width,
        height: media.height,
        thumbnailUrl: media.thumbnailUrl,
      };
    case "video":
      return {
        kind: "video",
        url: media.url,
        posterUrl: media.posterUrl,
        width: media.width,
        height: media.height,
        durationMs: media.durationMs,
      };
    case "essay_text":
      return { kind: "essay_text", html: media.html };
    case "document":
      return { kind: "document", url: media.url };
    case "unavailable":
      return { kind: "unavailable" };
  }
}

/**
 * Every key path in a JSON-like value, sorted, each once: `a`, `a.b`, and
 * `a[].c` for the keys of objects inside the array `a`. The no-PII tests
 * compare a view's paths with `BLIND_ENTRY_VIEW_KEY_PATHS`.
 */
export function keyPaths(value: unknown): string[] {
  const paths = new Set<string>();
  const walk = (node: unknown, prefix: string) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, `${prefix}[]`);
    } else if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        const path = prefix === "" ? key : `${prefix}.${key}`;
        paths.add(path);
        walk(child, path);
      }
    }
  };
  walk(value, "");
  return [...paths].sort();
}
