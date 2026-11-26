// What a judge declares before judging a round (#95): either "no
// conflicts", or the institutions they are connected to and a free-text
// statement. Institutions become conflicts with every entry from them;
// staff read the statement and turn the people it names into conflicts
// with single entries, since a blind judge can't name an entry. The
// statement may name third parties: it is personal data, never logged or
// audited in full.
//
// Wording of the declaration is FOA's to confirm (HR-39).
//
// Loads under plain Node (seed script): relative imports only.

import { z } from "zod";

export const MAX_CONFLICT_INSTITUTIONS = 20;
export const MAX_CONFLICT_STATEMENT_LENGTH = 1000;

const conflictsSchema = z
  .strictObject({
    none: z.literal(false),
    institutionIds: z
      .array(z.uuid())
      .max(MAX_CONFLICT_INSTITUTIONS)
      .default([])
      .transform((ids) => [...new Set(ids)]),
    statement: z.string().trim().max(MAX_CONFLICT_STATEMENT_LENGTH).default(""),
  })
  .refine(
    (declaration) =>
      declaration.institutionIds.length > 0 || declaration.statement !== "",
    { message: "conflicts_empty", path: ["statement"] }
  );

/** A declaration from untrusted input. */
export const conflictDeclarationSchema = z.union([
  z.strictObject({ none: z.literal(true) }),
  conflictsSchema,
]);

export type ConflictDeclaration = z.infer<typeof conflictDeclarationSchema>;
