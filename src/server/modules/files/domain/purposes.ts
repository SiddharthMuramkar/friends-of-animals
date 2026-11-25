// What may be uploaded, per purpose. A module that takes uploads adds its
// purpose here (and the matching value to the `file_asset_purpose` enum, in a
// migration of its own). The server checks these rules when it presigns an
// upload and again against the stored object, because the browser's
// declaration can't be trusted.

import type { Env } from "@/env.schema";

type AppEnv = Env["APP_ENV"];

const MiB = 1024 * 1024;

export const FILE_PURPOSES = [
  "test_upload",
  "cms_image",
  "offline_payment_proof",
  "consent_form",
  "entry_image",
  "directory_document",
  "adoption_photo",
  "entry_video",
  "entry_document",
  "offline_donation_proof",
  "artwork_condition_photo",
] as const;

export type FilePurpose = (typeof FILE_PURPOSES)[number];

/**
 * An entry's uploads (#85, #86): presigned, completed and read only through
 * the Entries module, which checks who may see the entry.
 */
export const ENTRY_FILE_PURPOSES = [
  "entry_image",
  "entry_video",
  "entry_document",
] as const satisfies readonly FilePurpose[];

export type EntryFilePurpose = (typeof ENTRY_FILE_PURPOSES)[number];

export function isEntryFilePurpose(
  purpose: string
): purpose is EntryFilePurpose {
  return (ENTRY_FILE_PURPOSES as readonly string[]).includes(purpose);
}

/**
 * Types that can be opened as stored. HTML, SVG and other active content
 * are never on this list: a signed URL would serve them from the storage
 * origin.
 */
export const STORABLE_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

export type StorableContentType = (typeof STORABLE_CONTENT_TYPES)[number];

/**
 * Phone video formats an entry takes (#86). An original is kept private and
 * never served: people watch the transcoded copy worker-media makes.
 */
export const VIDEO_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/3gpp",
  "video/webm",
] as const;

export type VideoContentType = (typeof VIDEO_CONTENT_TYPES)[number];

export type PurposeRule = {
  /**
   * HEIC and HEIF originals, and videos, are accepted for private
   * processing only.
   */
  contentTypes: readonly (
    | StorableContentType
    | "image/heic"
    | "image/heif"
    | VideoContentType
  )[];
  maxBytes: number;
  /**
   * A video purpose's longest clip, as worker-media's ffprobe measures it
   * (#86). The browser and the upload check the length they are told,
   * against the same limit, only to answer sooner.
   */
  maxDurationMs?: number;
  /** `non_production`: refused when APP_ENV is production. */
  environments: "all" | "non_production";
  /**
   * Whether any signed-in user may presign one with `requestUpload`. False
   * for a purpose only its module's own use case presigns, after its own
   * authorization (a post's images: `uploadPostImage`, #112).
   */
  directUpload: boolean;
};

export const PURPOSE_RULES = {
  /** The signed-in demo page and the Seam 2 round trip. */
  test_upload: {
    contentTypes: STORABLE_CONTENT_TYPES,
    maxBytes: 10 * MiB,
    environments: "non_production",
    directUpload: true,
  },
  /**
   * A blog post's or story's cover and inline images (#112). Shown publicly
   * only through their resized copies (./media-work.ts).
   */
  cms_image: {
    contentTypes: ["image/png", "image/jpeg", "image/webp"],
    maxBytes: 20 * MiB,
    environments: "all",
    directUpload: false,
  },
  /**
   * A photo or scan of a cheque, a bank's transfer advice or a cash receipt
   * that finance records an offline payment with (#79). A cheque image
   * shows an account number and a signature: only finance and staff
   * admins read it, and only `requestOfflinePaymentProofUpload` presigns
   * one, after its own authorization.
   */
  // A donation's proof is read only through the finance donation use case.
  offline_donation_proof: {
    contentTypes: STORABLE_CONTENT_TYPES,
    maxBytes: 10 * MiB,
    environments: "all",
    directUpload: false,
  },
  offline_payment_proof: {
    contentTypes: STORABLE_CONTENT_TYPES,
    maxBytes: 10 * MiB,
    environments: "all",
    directUpload: false,
  },
  /**
   * A participant's picture of their work, or a scan of it (#85). Only
   * `startEntryUpload` presigns one, after the entry's own rules
   * (src/server/modules/entries/rules.ts); the original stays private and
   * people see its derivatives.
   */
  entry_image: {
    contentTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ],
    maxBytes: 20 * MiB,
    environments: "all",
    directUpload: false,
  },
  /**
   * A participant's video of their work (#86). Only `startEntryUpload`
   * presigns one; worker-media transcodes it, and people watch the copy.
   */
  entry_video: {
    contentTypes: VIDEO_CONTENT_TYPES,
    maxBytes: 200 * MiB,
    maxDurationMs: 3 * 60 * 1000,
    environments: "all",
    directUpload: false,
  },
  /**
   * A participant's essay as a PDF (#86). Only `startEntryUpload` presigns
   * one; the scan and blind-judging raster copy must be ready (#96).
   */
  entry_document: {
    contentTypes: ["application/pdf"],
    maxBytes: 10 * MiB,
    environments: "all",
    directUpload: false,
  },
  /** A private scan of a guardian’s signed consent form (#83). */
  consent_form: {
    contentTypes: ["application/pdf", "image/jpeg", "image/png"],
    maxBytes: 10 * MiB,
    environments: "non_production",
    directUpload: false,
  },
  /**
   * Proof an NGO directory listing sends for FOA's verification (#127): a
   * registration certificate, an identity proof. Only staff read it, never
   * its uploader (./use-cases/delivery.ts), and only
   * `requestListingDocumentUpload` presigns one, after the listing's own
   * authorization.
   */
  directory_document: {
    contentTypes: ["application/pdf", "image/jpeg", "image/png"],
    maxBytes: 10 * MiB,
    environments: "all",
    directUpload: false,
  },
  /**
   * A photo of an animal listed for adoption (#129). Only
   * `requestAdoptionPhotoUpload` presigns one, after the adoption listing's
   * own authorization. The original stays private: the public sees only
   * its resized copies (./media-work.ts), and only while the animal is
   * public.
   */
  adoption_photo: {
    contentTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ],
    maxBytes: 15 * MiB,
    environments: "all",
    directUpload: false,
  },
  /** Private custody evidence, uploaded by an artwork verifier only. */
  artwork_condition_photo: {
    contentTypes: ["image/jpeg", "image/png", "image/heic", "image/heif"],
    maxBytes: 20 * MiB,
    environments: "all",
    directUpload: false,
  },
} satisfies Record<FilePurpose, PurposeRule>;

export type UploadRefusal =
  | "purpose_unavailable"
  | "type_not_allowed"
  | "too_large"
  | "empty";

export type StoredObjectRefusal =
  | "upload_missing"
  | "size_mismatch"
  | "type_mismatch";

export type Check<Refusal> = { ok: true } | { ok: false; refusal: Refusal };

/** How types are compared and stored: trimmed and lower-cased. */
export function normaliseContentType(contentType: string): string {
  return contentType.trim().toLowerCase();
}

function isStorable(rule: PurposeRule, contentType: string): boolean {
  return (rule.contentTypes as readonly string[]).includes(
    normaliseContentType(contentType)
  );
}

export function isFilePurposeAvailable(purpose: FilePurpose, appEnv: AppEnv) {
  return (
    PURPOSE_RULES[purpose].environments === "all" || appEnv !== "production"
  );
}

/**
 * Whether an upload of `sizeBytes` bytes of `contentType` may be presigned
 * for `purpose`. Checks the purpose, then the type, then the size.
 */
export function checkUploadRequest(
  request: { purpose: FilePurpose; contentType: string; sizeBytes: number },
  appEnv: AppEnv
): Check<UploadRefusal> {
  const rule = PURPOSE_RULES[request.purpose];
  if (!isFilePurposeAvailable(request.purpose, appEnv)) {
    return { ok: false, refusal: "purpose_unavailable" };
  }
  if (!isStorable(rule, request.contentType)) {
    return { ok: false, refusal: "type_not_allowed" };
  }
  if (!Number.isInteger(request.sizeBytes) || request.sizeBytes < 1) {
    return { ok: false, refusal: "empty" };
  }
  if (request.sizeBytes > rule.maxBytes) {
    return { ok: false, refusal: "too_large" };
  }
  return { ok: true };
}

/**
 * Whether the object storage holds what was declared at presign: the same
 * size and type. `stored` is the storage's HEAD answer, null if no object.
 */
export function checkStoredObject(
  declared: { contentType: string; sizeBytes: number },
  stored: { sizeBytes: number; contentType: string | null } | null
): Check<StoredObjectRefusal> {
  if (stored === null) return { ok: false, refusal: "upload_missing" };
  if (stored.sizeBytes !== declared.sizeBytes) {
    return { ok: false, refusal: "size_mismatch" };
  }
  if (
    stored.contentType === null ||
    normaliseContentType(stored.contentType) !==
      normaliseContentType(declared.contentType)
  ) {
    return { ok: false, refusal: "type_mismatch" };
  }
  return { ok: true };
}
