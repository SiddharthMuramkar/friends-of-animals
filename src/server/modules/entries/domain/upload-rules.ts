// Which files an entry takes: types and a size limit per discipline. The
// same check runs in the browser, before anything is uploaded, and on the
// server when the upload starts and again when it completes.
//
// Browsers often report an empty or generic type for HEIC photos, so the
// file name's extension decides when the reported type says nothing.
//
// Pure: no I/O, no "server-only", so the upload form can import it.

export const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type AcceptedType = (typeof IMAGE_TYPES)[number];

export type UploadRule = {
  acceptedTypes: readonly AcceptedType[];
  maxBytes: number;
};

/**
 * Drawing, painting, art, craft and photography until FOA sets its own
 * limits: phone and scanner photos up to 20 MB.
 */
export const DEFAULT_IMAGE_RULE: UploadRule = {
  acceptedTypes: IMAGE_TYPES,
  maxBytes: 20 * 1024 * 1024,
};

const EXTENSIONS: Readonly<Record<AcceptedType, readonly string[]>> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
};

const ALIASES: Readonly<Record<string, string>> = { "image/jpg": "image/jpeg" };

/** Reported types that say nothing about the file. */
const UNINFORMATIVE = new Set(["", "application/octet-stream"]);

function typeFromExtension(name: string): AcceptedType | null {
  const lower = name.toLowerCase();
  for (const type of IMAGE_TYPES) {
    if (EXTENSIONS[type].some((extension) => lower.endsWith(extension))) {
      return type;
    }
  }
  return null;
}

/**
 * The file's type: the reported one, normalised, or the one its extension
 * names when the reported type is empty or generic. Null if neither says.
 */
export function uploadTypeOf(file: { name: string; type: string }) {
  const reported = file.type.split(";")[0]!.trim().toLowerCase();
  if (UNINFORMATIVE.has(reported)) return typeFromExtension(file.name);
  return ALIASES[reported] ?? reported;
}

export type UploadCheck =
  | { ok: true; contentType: AcceptedType }
  | { ok: false; reason: "empty" | "wrong_type" | "too_large" };

/** Checks one file against a rule: empty first, then type, then size. */
export function checkUpload(
  file: { name: string; type: string; size: number },
  rule: UploadRule
): UploadCheck {
  if (!Number.isInteger(file.size) || file.size < 1) {
    return { ok: false, reason: "empty" };
  }
  const type = uploadTypeOf(file);
  const accepted = rule.acceptedTypes.find((candidate) => candidate === type);
  if (!accepted) return { ok: false, reason: "wrong_type" };
  if (file.size > rule.maxBytes) return { ok: false, reason: "too_large" };
  return { ok: true, contentType: accepted };
}

/** The file input's `accept` value: the types, then their extensions. */
export function acceptAttribute(rule: UploadRule): string {
  return [
    ...rule.acceptedTypes,
    ...rule.acceptedTypes.flatMap((type) => EXTENSIONS[type]),
  ].join(",");
}
