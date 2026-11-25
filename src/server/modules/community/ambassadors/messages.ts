import { eq } from "drizzle-orm";
import type { FieldCipher } from "../../../crypto/field-cipher";
import type { AppDb } from "../../../db/app-db";
import { ambassadorApplication } from "../../../db/schema";
import type { AudienceMember } from "../../notifications/domain/audience-member";
import { communityManagers } from "../../volunteers/message-audiences";
import { AMBASSADOR_DECLINE_PURPOSE } from "./fields";

async function application(db: AppDb, id: string) {
  const [row] = await db
    .select()
    .from(ambassadorApplication)
    .where(eq(ambassadorApplication.id, id));
  return row ?? null;
}

// Deliberately inbox-only: no free-text reason or potentially sensitive
// decision leaves a signed-in account, even if someone edits a route.
export async function ambassadorApplicant(
  db: AppDb,
  id: string
): Promise<AudienceMember[]> {
  const row = await application(db, id);
  return row ? [{ userId: row.applicantUserId, channels: "in_app_only" }] : [];
}
export async function ambassadorReviewers(
  db: AppDb,
  id: string
): Promise<AudienceMember[]> {
  if ((await application(db, id))?.status !== "submitted") return [];
  return (await communityManagers(db)).map((userId) => ({
    userId,
    channels: "in_app_only",
  }));
}
export async function ambassadorDeclineValues(
  db: AppDb,
  id: string,
  cipher: FieldCipher
): Promise<Record<string, string>> {
  const row = await application(db, id);
  return row?.declineReasonCiphertext
    ? {
        "decline.reason": cipher.decrypt(
          AMBASSADOR_DECLINE_PURPOSE,
          row.declineReasonCiphertext
        ),
      }
    : {};
}
