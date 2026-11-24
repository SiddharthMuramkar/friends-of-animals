import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { directTls } from "../../../src/server/db/database-url";
import {
  breachNotification,
  breachUnreachable,
  user,
} from "../../../src/server/db/schema";
import { uuidv7 } from "../../../src/server/ids";
import { localSeedUrl } from "./seed-account";

/** Adds synthetic delivery outcomes to a record created by this test. */
export async function seedBreachReach(
  baseURL: string | undefined,
  breachId: string,
  email: string
) {
  const url = localSeedUrl(baseURL);
  const client = postgres(url, { ...directTls(url), max: 1, prepare: false });
  const db = drizzle(client);
  try {
    await db.transaction(async (tx) => {
      const [recipient] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email));
      if (!recipient) throw new Error("Missing notice fixture account");
      const now = new Date();
      await tx.insert(breachNotification).values(
        (["email", "in_app"] as const).map((channel) => ({
          id: uuidv7(now),
          breachId,
          recipientUserId: recipient.id,
          channel,
          recipientRole: "principal" as const,
          aboutCount: 1,
          queuedAt: now,
          sentAt: now,
        }))
      );
      await tx.insert(breachUnreachable).values({
        breachId,
        subjectType: "participant_profile",
        subjectId: uuidv7(now),
        reason: "no_guardian",
        recordedAt: now,
      });
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}
