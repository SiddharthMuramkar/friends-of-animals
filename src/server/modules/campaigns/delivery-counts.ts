// How a sent campaign's messages stand (#126): numbers only, never who.
//
// Loads under plain Node (the worker): relative imports only.

import { count, eq } from "drizzle-orm";

import type { AppDb } from "../../db/app-db";
import { campaignRecipient } from "../../db/schema";

export type DeliveryCounts = { queued: number; sent: number; skipped: number };

export async function deliveryCounts(
  db: AppDb,
  campaignId: string
): Promise<DeliveryCounts> {
  const rows = await db
    .select({ status: campaignRecipient.status, n: count() })
    .from(campaignRecipient)
    .where(eq(campaignRecipient.campaignId, campaignId))
    .groupBy(campaignRecipient.status);
  const counts: DeliveryCounts = { queued: 0, sent: 0, skipped: 0 };
  for (const { status, n } of rows) counts[status] = n;
  return counts;
}
