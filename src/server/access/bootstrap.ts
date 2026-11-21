import type { DbWithClock } from "../db/app-db";

export async function bootstrapSuperAdmin(
  _deps: DbWithClock,
  _account: { email: string; name: string }
): Promise<{ userId: string; changed: boolean }> {
  return { userId: "", changed: false };
}
