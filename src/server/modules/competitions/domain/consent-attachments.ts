// Consent documents attached to a competition (#72). A competition pins one
// published version per purpose, so every consent given for it points at
// the exact text agreed. Publishing a newer version in the Consent module
// (#64) changes nothing here until a manager re-attaches.
//
// Plain TypeScript with no imports, so the schema file and the seed script
// can load it under plain Node.

/**
 * Purposes a competition can attach, from the Consent module's
 * `consent_purpose`: the documents a registrant agrees to, then the ones a
 * guardian gives one by one for a child (#82). Showing the school and the
 * city are options of public display, with no document of their own.
 */
export const ATTACHABLE_PURPOSES = [
  "competition_terms",
  "privacy_notice",
  "participation",
  "public_display",
  "social_media",
  "auction",
] as const;

export type AttachablePurpose = (typeof ATTACHABLE_PURPOSES)[number];

/** The documents a guardian consents to for a child, each on its own (#82). */
const GUARDIAN_DOCUMENTS: readonly AttachablePurpose[] = [
  "participation",
  "public_display",
  "social_media",
  "auction",
];

/** Purposes everyone must agree to before registering. */
const REQUIRED_FOR_REGISTRATION: readonly AttachablePurpose[] = [
  "competition_terms",
  "privacy_notice",
];

export function isAttachablePurpose(
  purpose: string
): purpose is AttachablePurpose {
  return (ATTACHABLE_PURPOSES as readonly string[]).includes(purpose);
}

/**
 * Whether a guardian gives this document's consent for a child, rather than
 * a registrant agreeing to it for themselves.
 */
export function isGuardianDocument(purpose: AttachablePurpose): boolean {
  return GUARDIAN_DOCUMENTS.includes(purpose);
}

/** Whether a registrant must agree to this purpose's document. */
export function isRequiredForRegistration(purpose: AttachablePurpose): boolean {
  return REQUIRED_FOR_REGISTRATION.includes(purpose);
}

/** A published consent document version (the Consent module's row). */
export type DocumentVersion = { id: string; version: number };

export type AttachError = "not_attachable" | "no_published_version";

/**
 * Decides what to pin when a manager attaches (or re-attaches) a purpose:
 * always the latest published version. `changed` is false when that version
 * is already pinned, so nothing is written or audited.
 */
export function decideAttach(
  purpose: string,
  latest: DocumentVersion | null,
  pinned: DocumentVersion | null
):
  | {
      ok: true;
      value: { documentId: string; version: number; changed: boolean };
    }
  | { ok: false; error: AttachError } {
  if (!isAttachablePurpose(purpose)) {
    return { ok: false, error: "not_attachable" };
  }
  if (latest === null) return { ok: false, error: "no_published_version" };
  return {
    ok: true,
    value: {
      documentId: latest.id,
      version: latest.version,
      changed: pinned?.id !== latest.id,
    },
  };
}

export type AttachmentState = "not_attached" | "current" | "newer_available";

/** What the admin screen says about one purpose's pin. */
export function attachmentState(
  pinned: DocumentVersion | null,
  latest: DocumentVersion | null
): AttachmentState {
  if (pinned === null) return "not_attached";
  if (latest !== null && latest.version > pinned.version) {
    return "newer_available";
  }
  return "current";
}

/** The largest version a Postgres `integer` column holds. */
const MAX_VERSION = 2_147_483_647;

/**
 * Where a published version of an attachable document reads, for
 * everyone: `/documents/competition-terms/2`.
 */
export function documentVersionPath(
  purpose: AttachablePurpose,
  version: number
): `/documents/${string}` {
  return `/documents/${purpose.replaceAll("_", "-")}/${version}`;
}

/**
 * The purpose and version a document path names, or null when it names
 * no attachable purpose or no plain positive version.
 */
export function parseDocumentVersionPath(
  purposeSegment: string,
  versionSegment: string
): { purpose: AttachablePurpose; version: number } | null {
  const purpose = ATTACHABLE_PURPOSES.find(
    (candidate) => candidate.replaceAll("_", "-") === purposeSegment
  );
  if (purpose === undefined || !/^[1-9]\d{0,9}$/.test(versionSegment)) {
    return null;
  }
  const version = Number(versionSegment);
  return version <= MAX_VERSION ? { purpose, version } : null;
}
