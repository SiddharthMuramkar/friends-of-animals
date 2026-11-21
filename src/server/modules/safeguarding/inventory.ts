// Safeguarding data inventory and retention (#116). Stub.

import type { AppDb } from "../../db/app-db";

export type SafeguardingInventoryEntry = {
  table: string;
  column: string;
  purpose: string;
  retention: { period: string; basis: string; toConfirm: true; policy: string };
};

export const SAFEGUARDING_INVENTORY: SafeguardingInventoryEntry[] = [];

export const SAFEGUARDING_RETENTION_POLICY = { key: "" };

export async function safeguardingRetentionCandidates(
  _db: AppDb,
  _now: Date
): Promise<string[]> {
  return [];
}
