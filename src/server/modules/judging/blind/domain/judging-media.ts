// What a judge is shown of an entry's work: always a copy the media worker
// derived (metadata stripped, resized or transcoded), never the uploaded
// original, which can carry GPS, camera and author details. A file whose
// copy isn't ready shows as unavailable rather than falling back.
//
// The input type has no field for the original on purpose: the query that
// fills it selects derivatives only.
//
// Loads under plain Node (seed script): relative imports only.

/** One derived copy, as the Files module stores it. */
export type JudgingDerivative = {
  /** `thumb_320`, `display_1600`, `poster`, `video_mp4`, `pdf_clean`, … */
  kind: string;
  bucket: string;
  storageKey: string;
  contentType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

/** An entry's live file, as far as judging needs it. */
export type JudgingFile =
  | {
      kind: "image" | "video" | "document";
      derivatives: readonly JudgingDerivative[];
    }
  /** A typed essay: its text, already through the rich-text sanitiser. */
  | { kind: "text"; text: string | null };

export type MediaPlan =
  | {
      kind: "image";
      display: JudgingDerivative;
      thumbnail: JudgingDerivative | null;
    }
  | {
      kind: "video";
      video: JudgingDerivative;
      poster: JudgingDerivative | null;
    }
  | { kind: "essay_text"; text: string }
  | { kind: "document"; document: JudgingDerivative }
  | { kind: "unavailable" };

const UNAVAILABLE: MediaPlan = { kind: "unavailable" };

/** Which derived copies show this file to a judge. */
export function planJudgingMedia(file: JudgingFile): MediaPlan {
  if (file.kind === "text") {
    return file.text === null
      ? UNAVAILABLE
      : { kind: "essay_text", text: file.text };
  }
  const find = (kind: string) =>
    file.derivatives.find((derivative) => derivative.kind === kind) ?? null;
  switch (file.kind) {
    case "image": {
      const display = find("display_1600");
      return display
        ? { kind: "image", display, thumbnail: find("thumb_320") }
        : UNAVAILABLE;
    }
    case "video": {
      const video = find("video_mp4");
      return video
        ? { kind: "video", video, poster: find("video_poster") }
        : UNAVAILABLE;
    }
    case "document": {
      const document = find("pdf_clean");
      return document ? { kind: "document", document } : UNAVAILABLE;
    }
  }
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};

/**
 * The download name a signed URL carries. It names only the position of the
 * work in the entry, never the participant, their registration or the file
 * name they uploaded.
 */
export function blindMediaFilename(
  contentType: string,
  position: number
): string {
  if (!Number.isInteger(position) || position < 1) {
    throw new RangeError("A media position is a whole number from 1");
  }
  return `work-${position}.${EXTENSIONS[contentType] ?? "bin"}`;
}
