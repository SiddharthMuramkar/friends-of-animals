// Proof a listing uploads for FOA's verification (#127). Documents are
// private files that only staff can open. The checklist tells staff what to
// expect for each listing type; it guides their decision and is not
// enforced, because FOA's real checklist is still to come (HR-62).
//
// Loads under plain Node (schema): no "server-only", no `@/` imports.

import { isIndividualListing, type ListingType } from "./catalogue";

export const DOCUMENT_KINDS = [
  "registration_certificate",
  "awbi_recognition",
  "identity_proof",
  "address_proof",
  "other",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

type Expectation = { required: DocumentKind[]; optional: DocumentKind[] };

/** Default until FOA's checklist arrives (HR-62). */
function expectedDocuments(type: ListingType): Expectation {
  return isIndividualListing(type)
    ? { required: ["identity_proof"], optional: ["address_proof"] }
    : {
        required: ["registration_certificate"],
        optional: ["awbi_recognition"],
      };
}

export type ChecklistItem = {
  kind: DocumentKind;
  /** "extra": uploaded, though the checklist didn't ask for it. */
  expected: "required" | "optional" | "extra";
  provided: boolean;
};

/** What staff should see for a `type` listing that uploaded `uploaded`. */
export function documentChecklist(
  type: ListingType,
  uploaded: readonly DocumentKind[]
): ChecklistItem[] {
  const { required, optional } = expectedDocuments(type);
  const asked = new Set<DocumentKind>([...required, ...optional]);
  const provided = new Set(uploaded);
  return [
    ...required.map((kind) => ({
      kind,
      expected: "required" as const,
      provided: provided.has(kind),
    })),
    ...optional.map((kind) => ({
      kind,
      expected: "optional" as const,
      provided: provided.has(kind),
    })),
    ...DOCUMENT_KINDS.filter(
      (kind) => provided.has(kind) && !asked.has(kind)
    ).map((kind) => ({ kind, expected: "extra" as const, provided: true })),
  ];
}
