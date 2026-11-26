import { eq } from "drizzle-orm";
import type { AppDb } from "../../db/app-db";
import { competition, entry, entryVerification } from "../../db/schema";

export const SEND_BACK_REASONS = {
  file_unreadable: "The uploaded work is unreadable.",
  wrong_work: "The uploaded work does not match the entry.",
  missing_declaration: "A required declaration is missing.",
  other: "Other correction requested.",
} as const;

export const VERIFICATION_VARIABLES = [
  "entry.code",
  "competition.name",
  "verification.reason",
  "verification.deadline",
] as const;

export async function verificationValues(
  db: AppDb,
  verificationId: string
): Promise<Record<string, string>> {
  const [row] = await db
    .select({
      code: entry.code,
      name: competition.name,
      reason: entryVerification.reasonCode,
      text: entryVerification.reasonText,
      deadline: entryVerification.resubmissionDueAt,
    })
    .from(entryVerification)
    .innerJoin(entry, eq(entry.id, entryVerification.entryId))
    .innerJoin(competition, eq(competition.id, entry.competitionId))
    .where(eq(entryVerification.id, verificationId));
  if (!row) return {};
  return {
    "entry.code": row.code,
    "competition.name": row.name,
    "verification.reason": [
      row.reason
        ? SEND_BACK_REASONS[row.reason as keyof typeof SEND_BACK_REASONS]
        : null,
      row.text,
    ]
      .filter(Boolean)
      .join(" "),
    "verification.deadline": row.deadline
      ? new Intl.DateTimeFormat("en-IN", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: "Asia/Kolkata",
        }).format(row.deadline) + " IST"
      : "",
  };
}
