import { z } from "zod";

import {
  LEGAL_HOLD_REASON_MAX,
  LEGAL_HOLD_SUBJECT_TYPES,
} from "../../db/schema/privacy";

export const placeLegalHoldInput = z.object({
  subjectType: z.enum(LEGAL_HOLD_SUBJECT_TYPES),
  subjectId: z.uuid(),
  reason: z.string().trim().min(1).max(LEGAL_HOLD_REASON_MAX),
});

export type PlaceLegalHoldInput = {
  subjectType: string;
  subjectId: string;
  reason: string;
};

export const releaseLegalHoldInput = z.object({ holdId: z.uuid() });

const cursorFields = z.tuple([
  z.iso
    .datetime({ precision: 6 })
    .refine((value) => !value.startsWith("0000-")),
  z.uuid(),
]);

export function legalHoldCursor(cursor: string | undefined) {
  if (!cursor || cursor.length > 64) return null;
  const parsed = cursorFields.safeParse(cursor.split("_"));
  return parsed.success ? { at: parsed.data[0], id: parsed.data[1] } : null;
}
